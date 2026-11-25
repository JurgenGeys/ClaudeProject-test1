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
import { TECHNICIAN_ACTION_MESSAGES } from "@/lib/technicians/messages";
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
 * 3. Supabase Auth creates the user and sends the mail (`inviteUserByEmail`, secret key).
 *    An address that already exists in Auth without a profile is refused as well: it is
 *    never given a role here. The only exception is an invitation that was sent but not
 *    opened yet (Auth sends it again), which is how an interrupted attempt heals.
 * 4. The profile (role technician, `invite_pending`) is inserted. When that fails the Auth
 *    user is removed again, so no half-finished invitation stays behind; if that fails too,
 *    inviting again repairs it (step 3 resends, step 4 inserts).
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

    const { error } = await createSupabaseAdminClient().auth.admin.inviteUserByEmail(
      profile.email,
      { redirectTo: getInviteRedirectUrl() },
    );
    if (error) {
      const failure = classifyInviteError(error);
      if (failure === "exists") {
        return refused(TECHNICIAN_ACTION_MESSAGES.alreadyOpened(profile.fullName));
      }
      if (failure === "rate-limit") {
        return refused(TECHNICIAN_ACTION_MESSAGES.tooManyMails);
      }
      console.error("Resending an invitation failed:", describeError(error));
      return refused(LOGIN_MESSAGES.technicalProblem);
    }

    revalidatePath(PATH);
    return { ok: true, message: TECHNICIAN_ACTION_MESSAGES.resent(profile.email) };
  } catch (error) {
    console.error("Resending an invitation failed unexpectedly:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }
}
