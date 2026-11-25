"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole } from "@/lib/auth/session";
import { SiteUrlError, getInviteRedirectUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseCredentialsClient } from "@/lib/supabase/credentials";
import { AuthTimeoutError, BanFailedError, changeAuthBan } from "@/lib/technicians/ban";
import {
  AUTH_BAN_DURATION,
  INVITED_BY_APP_KEY,
  findAuthUserByEmail,
} from "@/lib/technicians/auth-users";
import { deactivateTechnicianProfile, type DeactivateOutcome } from "@/lib/technicians/deactivate";
import { TECHNICIAN_ACTION_MESSAGES } from "@/lib/technicians/messages";
import { reactivateTechnicianProfile, type ReactivateOutcome } from "@/lib/technicians/reactivate";
import { TECHNICIAN_MESSAGES } from "@/lib/validation/messages";
import { technicianIdSchema, technicianSchema } from "@/lib/validation/technician";

export type TechnicianFieldErrors = { fullName?: string; email?: string };

/**
 * Result of the actions of B7 (design chapter 6). `values` echoes what was typed, so the
 * dialog keeps it after a refused attempt.
 */
export type TechnicianActionState =
  | null
  | { ok: true; message: string }
  | {
      ok: false;
      fieldErrors: TechnicianFieldErrors;
      formError?: string;
      values?: { fullName: string; email: string };
      /** Set when switching off was refused because of open tasks: how many there are. */
      openTasks?: number;
    };

const PATH = "/technicians";

function refused(formError: string, values?: { fullName: string; email: string }) {
  return { ok: false as const, fieldErrors: {}, formError, ...(values ? { values } : {}) };
}

/** Only the kind of problem: the message of an error can contain an e-mail address. */
function describeError(error: unknown): string {
  if (error instanceof SiteUrlError) {
    return error.message; // Configuration problem, no personal data in it.
  }
  if (error && typeof error === "object" && "code" in error) {
    const { name, code, status } = error as { name?: string; code?: unknown; status?: unknown };
    return [name, code, status].filter((part) => part !== undefined).join(" ");
  }
  return error instanceof Error ? error.name : typeof error;
}

type InviteFailure = "exists" | "rate-limit" | "invalid-email" | "technical";

/** Sorts the error of `inviteUserByEmail` into what the screen needs to say. */
function classifyInviteError(error: { code?: string; status?: number }): InviteFailure {
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return "exists";
  }
  if (
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    error.status === 429
  ) {
    return "rate-limit";
  }
  if (error.code === "email_address_invalid") {
    return "invalid-email";
  }
  return "technical";
}

/**
 * Invites a technician (design B7, "Technieker toevoegen"). Order of the steps:
 * 1. `requireRole("backoffice")`, then Zod validation on the server.
 * 2. A profile with this e-mail address (any role) refuses the invitation: no second
 *    account, and a backoffice address can never become a technician.
 * 3. An Auth account with this address but without a profile is only reused when this
 *    application created it itself (marker `invited_by_app` in `app_metadata`, which only the
 *    admin API can set), i.e. an interrupted earlier invitation. Any other account, for
 *    example one that somebody registered by themselves, is refused as a duplicate and gets
 *    no role and no mail.
 * 4. Supabase Auth creates the user and sends the mail (`inviteUserByEmail`, secret key). For
 *    a new user the marker is set right after, with the admin API.
 * 5. The profile (role technician, `invite_pending`) is inserted. When that fails the Auth
 *    user is removed again, so no half-finished invitation stays behind; if that fails too,
 *    inviting again repairs it (the marker lets step 3 reuse the account, step 4 resends the
 *    mail, step 5 inserts).
 * The profile cannot come first: its primary key is the Auth user id.
 */
export async function inviteTechnician(
  _previous: TechnicianActionState,
  formData: FormData,
): Promise<TechnicianActionState> {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const raw = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
  };
  const parsed = technicianSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: TechnicianFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "fullName" || field === "email") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { ok: false, fieldErrors, values: raw };
  }
  const { fullName, email } = parsed.data;
  const values = { fullName, email };
  const duplicate = {
    ok: false as const,
    fieldErrors: { email: TECHNICIAN_MESSAGES.emailExists },
    values,
  };

  try {
    const db = getDb();
    const [existing] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(sql`lower(${profiles.email})`, email))
      .limit(1);
    if (existing) {
      return duplicate;
    }

    const existingAuth = await findAuthUserByEmail(db, email);
    if (existingAuth && !existingAuth.invitedByApp) {
      return duplicate;
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      // From the SITE_URL setting, never from the request (host header injection).
      redirectTo: getInviteRedirectUrl(),
    });
    if (error || !data.user) {
      const failure = error ? classifyInviteError(error) : "technical";
      if (failure === "exists") {
        return duplicate;
      }
      if (failure === "invalid-email") {
        return { ok: false, fieldErrors: { email: TECHNICIAN_MESSAGES.emailInvalid }, values };
      }
      if (failure === "rate-limit") {
        return refused(TECHNICIAN_ACTION_MESSAGES.tooManyMails, values);
      }
      console.error("Inviting a technician failed:", error ? describeError(error) : "no user");
      return refused(LOGIN_MESSAGES.technicalProblem, values);
    }

    const userId = data.user.id;
    if (existingAuth && existingAuth.id !== userId) {
      // Not the account we looked at: something is wrong, so add nothing.
      console.error("Inviting a technician returned another Auth user than expected.");
      return refused(LOGIN_MESSAGES.technicalProblem, values);
    }
    if (!existingAuth) {
      const { error: markError } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: { [INVITED_BY_APP_KEY]: true },
      });
      if (markError) {
        console.error("Marking an invited Auth user failed:", describeError(markError));
        const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
        if (cleanupError) {
          console.error("Removing the Auth user again failed:", describeError(cleanupError));
        }
        return refused(LOGIN_MESSAGES.technicalProblem, values);
      }
    }
    let inserted: { id: string }[];
    try {
      inserted = await db
        .insert(profiles)
        .values({ id: userId, fullName, email, role: "technician", invitePending: true })
        .onConflictDoNothing()
        .returning({ id: profiles.id });
    } catch (insertError) {
      console.error(
        "Saving the profile of an invited technician failed:",
        describeError(insertError),
      );
      // Undo the Auth user (and with it the mail link) so nothing half-finished remains.
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
      if (cleanupError) {
        console.error("Removing the Auth user again failed:", describeError(cleanupError));
      }
      return refused(LOGIN_MESSAGES.technicalProblem, values);
    }
    if (inserted.length === 0) {
      // Someone else added the same address a moment ago. Their profile stays; nothing is removed.
      return duplicate;
    }
  } catch (error) {
    console.error("Inviting a technician failed unexpectedly:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem, values);
  }

  revalidatePath(PATH);
  return { ok: true, message: TECHNICIAN_ACTION_MESSAGES.invited(email) };
}

/**
 * Sends the invitation again to a technician who has not chosen a password yet (design B7,
 * "Uitnodiging opnieuw versturen"). Takes the id of the technician from a hidden field and
 * reads everything else from the database: the e-mail address is never taken from the form.
 */
export async function resendInvite(
  _previous: TechnicianActionState,
  formData: FormData,
): Promise<TechnicianActionState> {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const id = technicianIdSchema.safeParse(formData.get("id"));
  if (!id.success) {
    return refused(TECHNICIAN_ACTION_MESSAGES.notFound);
  }

  try {
    const profile = await getDb().query.profiles.findFirst({ where: eq(profiles.id, id.data) });
    if (!profile || profile.role !== "technician") {
      return refused(TECHNICIAN_ACTION_MESSAGES.notFound);
    }
    if (!profile.isActive) {
      return refused(TECHNICIAN_ACTION_MESSAGES.disabled(profile.fullName));
    }
    if (!profile.invitePending) {
      return refused(TECHNICIAN_ACTION_MESSAGES.alreadyAccepted(profile.fullName));
    }

    const redirectTo = getInviteRedirectUrl();
    const { error } = await createSupabaseAdminClient().auth.admin.inviteUserByEmail(
      profile.email,
      { redirectTo },
    );
    if (error) {
      const failure = classifyInviteError(error);
      if (failure === "rate-limit") {
        return refused(TECHNICIAN_ACTION_MESSAGES.tooManyMails);
      }
      if (failure !== "exists") {
        console.error("Resending an invitation failed:", describeError(error));
        return refused(LOGIN_MESSAGES.technicalProblem);
      }

      // The first link was already opened, so Supabase sees a confirmed address and sends no
      // invitation any more. The technician still has no password (`invite_pending`), so he gets
      // Supabase's own mail for a one-time link of the type `recovery`. `/auth/confirm` accepts
      // it for a pending technician, and it leads to the same "Wachtwoord instellen" page.
      // `admin.generateLink` would give a link too, but we would have to send the mail ourselves.
      const { error: recoveryError } =
        await createSupabaseCredentialsClient().auth.resetPasswordForEmail(profile.email, {
          redirectTo,
        });
      if (recoveryError) {
        if (classifyInviteError(recoveryError) === "rate-limit") {
          return refused(TECHNICIAN_ACTION_MESSAGES.tooManyMails);
        }
        console.error("Resending an invitation by recovery failed:", describeError(recoveryError));
        return refused(LOGIN_MESSAGES.technicalProblem);
      }
    }

    revalidatePath(PATH);
    return { ok: true, message: TECHNICIAN_ACTION_MESSAGES.resent(profile.email) };
  } catch (error) {
    console.error("Resending an invitation failed unexpectedly:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }
}

/**
 * Best-effort change of the block, outside any transaction (compensation and repair). A failure is
 * only logged, with the technician id (a UUID, no e-mail address or name) so the account can be
 * found; the user gets the message he would have got anyway.
 */
async function tryChangeBan(technicianId: string, banDuration: string, what: string) {
  try {
    await changeAuthBan(createSupabaseAdminClient(), technicianId, banDuration);
  } catch (error) {
    console.error(
      `${what} for technician ${technicianId}:`,
      describeError(error instanceof BanFailedError ? error.cause : error),
    );
  }
}

/**
 * Switches a technician off (design B7, "Uitschakelen"; BT-07). The technician comes from a
 * hidden field (id only); the name and the state are read from the database.
 *
 * One database transaction does everything that must not be separated:
 * 1. `deactivateTechnicianProfile` locks the profile, refuses when there are open tasks
 *    (Toegewezen or Opgepikt; the same count as B7 shows) and otherwise sets `is_active = false`
 *    and `deactivated_at = now()`.
 * 2. Still inside the transaction, the Auth account is blocked (`ban_duration`), so the technician
 *    gets no new session, cannot refresh an existing one and gets the general message when
 *    signing in. If that fails the transaction is rolled back: the technician is either fully
 *    switched off or not at all. If the commit itself fails after the block was set, the block is
 *    lifted again (best effort; a block without `is_active = false` only matters until the next
 *    attempt, which sets both again).
 * Existing sessions: `requireRole` reads `is_active` at every request, so a signed-in technician
 * is refused at once and sent to `/auth/inactive`; the block stops the session from being
 * refreshed afterwards. Tokens cannot be revoked by user id with the admin API, only by the
 * token of the session itself, which the server does not have.
 */
export async function deactivateTechnician(
  _previous: TechnicianActionState,
  formData: FormData,
): Promise<TechnicianActionState> {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const id = technicianIdSchema.safeParse(formData.get("id"));
  if (!id.success) {
    return refused(TECHNICIAN_ACTION_MESSAGES.notFound);
  }

  let banned = false;
  let outcome: DeactivateOutcome;
  try {
    const admin = createSupabaseAdminClient();
    outcome = await getDb().transaction(async (tx) => {
      const result = await deactivateTechnicianProfile(tx, id.data);
      if (result.kind === "deactivated") {
        await changeAuthBan(admin, id.data, AUTH_BAN_DURATION);
        banned = true;
      }
      return result;
    });
  } catch (error) {
    // After a time-out the block may have been applied anyway, so it is undone as well.
    if (banned || error instanceof AuthTimeoutError) {
      // The block was set but the commit failed: undo the block as well.
      await tryChangeBan(id.data, "none", "Lifting the block after a failed switch-off failed");
    }
    console.error(
      `Switching off technician ${id.data} failed:`,
      describeError(error instanceof BanFailedError ? error.cause : error),
    );
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  if (outcome.kind === "already-disabled") {
    // Also repairs an ambiguous commit: the database says switched off, so make sure Auth agrees.
    await tryChangeBan(
      id.data,
      AUTH_BAN_DURATION,
      "Repairing the block of a switched-off technician failed",
    );
  }

  switch (outcome.kind) {
    case "not-found":
      return refused(TECHNICIAN_ACTION_MESSAGES.notFound);
    case "already-disabled":
      return refused(TECHNICIAN_ACTION_MESSAGES.alreadyDisabled(outcome.fullName));
    case "invited":
      return refused(TECHNICIAN_ACTION_MESSAGES.notAccepted(outcome.fullName));
    case "open-tasks":
      return {
        ok: false,
        fieldErrors: {},
        formError: `${TECHNICIAN_ACTION_MESSAGES.cannotDeactivate} ${TECHNICIAN_ACTION_MESSAGES.hasOpenTasks(outcome.fullName, outcome.openTasks)}`,
        openTasks: outcome.openTasks,
      };
    case "deactivated":
      revalidatePath(PATH);
      return { ok: true, message: TECHNICIAN_ACTION_MESSAGES.deactivated(outcome.fullName) };
  }
}

/**
 * Switches a technician on again (design B7, "Opnieuw activeren"; P3, BT-07b). Mirror image of
 * `deactivateTechnician`: the technician comes from a hidden field (id only), and one database
 * transaction does everything that must not be separated:
 * 1. `reactivateTechnicianProfile` locks the profile, refuses anything but a switched-off
 *    technician and otherwise sets `is_active = true` and `deactivated_at = null`.
 * 2. Still inside the transaction, the block of the Auth account is lifted (`ban_duration: "none"`).
 *    If that fails the transaction is rolled back: the technician is either fully switched on or
 *    not at all. If the commit itself fails after the block was lifted, the block is set again
 *    (best effort; `requireRole` refuses a profile with `is_active = false` anyway).
 * The old password stays valid and no invitation is sent. Sessions that were ended stay ended: the
 * technician signs in again. Tasks are not assigned back.
 */
export async function reactivateTechnician(
  _previous: TechnicianActionState,
  formData: FormData,
): Promise<TechnicianActionState> {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const id = technicianIdSchema.safeParse(formData.get("id"));
  if (!id.success) {
    return refused(TECHNICIAN_ACTION_MESSAGES.notFound);
  }

  let unbanned = false;
  let outcome: ReactivateOutcome;
  try {
    const admin = createSupabaseAdminClient();
    outcome = await getDb().transaction(async (tx) => {
      const result = await reactivateTechnicianProfile(tx, id.data);
      if (result.kind === "reactivated") {
        await changeAuthBan(admin, id.data, "none");
        unbanned = true;
      }
      return result;
    });
  } catch (error) {
    // After a time-out the block may have been lifted anyway, so it is set again as well.
    if (unbanned || error instanceof AuthTimeoutError) {
      // The block was lifted but the commit failed: set the block again.
      await tryChangeBan(
        id.data,
        AUTH_BAN_DURATION,
        "Blocking the account again after a failed switch-on failed",
      );
    }
    console.error(
      `Switching on technician ${id.data} failed:`,
      describeError(error instanceof BanFailedError ? error.cause : error),
    );
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  if (outcome.kind === "already-active") {
    // Also repairs an ambiguous commit: the database says active, so make sure Auth agrees.
    await tryChangeBan(id.data, "none", "Repairing the block of an active technician failed");
  }

  switch (outcome.kind) {
    case "not-found":
      return refused(TECHNICIAN_ACTION_MESSAGES.notFound);
    case "already-active":
      return refused(TECHNICIAN_ACTION_MESSAGES.alreadyActive(outcome.fullName));
    case "invited":
      return refused(TECHNICIAN_ACTION_MESSAGES.notDisabled(outcome.fullName));
    case "reactivated":
      revalidatePath(PATH);
      return { ok: true, message: TECHNICIAN_ACTION_MESSAGES.reactivated(outcome.fullName) };
  }
}
