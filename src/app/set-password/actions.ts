"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { profiles, recoverySessions } from "@/db/schema";
import { endLocalSession } from "@/lib/auth/login-redirect";
import {
  LOGIN_MESSAGES,
  RESET_PASSWORD_MESSAGES,
  SET_PASSWORD_MESSAGES,
} from "@/lib/auth/messages";
import { LOGIN_PATH, SET_PASSWORD_MODE_RESET, homePathForRole } from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";
import { isTemporaryAuthError } from "@/lib/auth/temporary-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PASSWORD_MESSAGES } from "@/lib/validation/messages";
import { passwordFormSchema } from "@/lib/validation/password";

export type SetPasswordFieldErrors = { password?: string; confirmPassword?: string };

/** What the form shows after a refused attempt. A successful attempt redirects instead. */
export type SetPasswordState = { fieldErrors: SetPasswordFieldErrors; formError?: string } | null;

function refused(formError: string): SetPasswordState {
  return { fieldErrors: {}, formError };
}

/**
 * Chooses a password (design G2) and signs the user in for good. Deliberately no `requireRole`:
 * this is the one action that accepts the two restricted states of `getAuthState`, and nothing
 * else:
 * - `password-pending`: an invited technician. After the password: `invite_pending = false`.
 * - `reset-pending`: somebody who followed a "wachtwoord vergeten" link (BT-06b). After the
 *   password: every other session of this user is ended (`signOut` scope `others`; the person
 *   who forgot the password may not be the only one who is signed in), and all recovery rows of
 *   the user are deleted. The new password must differ from the old one.
 * Anyone else (no session, or a normal session) is refused, so the action cannot be used to
 * change somebody's password without knowing the old one.
 *
 * Order: first the password in Supabase Auth, (reset only) then the end of the other sessions,
 * then the recovery rows. When a later step fails the user is still restricted and tries
 * again. Auth then says the password is the same as the current one (`same_password`). For an
 * invitation that is accepted (it can only be the password this very session just chose). For a
 * reset it is refused with "Kies een ander wachtwoord dan je vorige." (decision Jurgen,
 * 25/11/2026); a retry after a failed later step then needs another password, which is harmless.
 */
export async function setPassword(
  _previous: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const state = await getAuthState();
  if (state.status === "unavailable") {
    return refused(LOGIN_MESSAGES.technicalProblem);
  }
  if (state.status === "invite-expired") {
    return refused(SET_PASSWORD_MESSAGES.inviteExpired);
  }
  if (state.status === "reset-expired") {
    return refused(RESET_PASSWORD_MESSAGES.expired);
  }
  if (state.status !== "password-pending" && state.status !== "reset-pending") {
    // The wording follows the screen the form was on (hidden field), not the session: there is
    // no session any more. A reset gets "Vraag een nieuwe link aan", an invitation "Vraag kantoor".
    return refused(
      formData.get("mode") === SET_PASSWORD_MODE_RESET
        ? `${RESET_PASSWORD_MESSAGES.linkInvalid} ${RESET_PASSWORD_MESSAGES.linkAdvice}`
        : `${SET_PASSWORD_MESSAGES.inviteLinkInvalid} ${SET_PASSWORD_MESSAGES.inviteLinkAdvice}`,
    );
  }

  const parsed = passwordFormSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: SetPasswordFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "password" || field === "confirmPassword") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  // `redirect()` throws, so it must stay outside the try/catch below.
  let destination: string;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error?.code === "same_password" && state.status === "reset-pending") {
      // A reset must change the password (decision Jurgen, 25/11/2026). An invitation has no
      // earlier password, so there `same_password` can only be this session's own retry.
      return { fieldErrors: { password: PASSWORD_MESSAGES.sameAsOld } };
    }
    if (error && error.code !== "same_password") {
      if (error.code === "weak_password") {
        return { fieldErrors: { password: PASSWORD_MESSAGES.tooWeak } };
      }
      if (error.code === "over_request_rate_limit" || error.status === 429) {
        return refused(LOGIN_MESSAGES.tooManyAttempts);
      }
      if (isTemporaryAuthError(error)) {
        return refused(LOGIN_MESSAGES.technicalProblem);
      }
      if (error.status === 401 || error.status === 403) {
        // The session of the link has ended in the meantime.
        return refused(
          state.status === "reset-pending"
            ? `${RESET_PASSWORD_MESSAGES.linkInvalid} ${RESET_PASSWORD_MESSAGES.linkAdvice}`
            : `${SET_PASSWORD_MESSAGES.inviteLinkInvalid} ${SET_PASSWORD_MESSAGES.inviteLinkAdvice}`,
        );
      }
      console.error("Setting a password failed:", error.name, error.code, error.status);
      return refused(LOGIN_MESSAGES.technicalProblem);
    }

    const db = getDb();
    if (state.status === "reset-pending") {
      // The password is new, so every other session of this user must go. A failure here is
      // not swallowed: the user stays restricted and tries again.
      const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
      if (signOutError) {
        if (!isTemporaryAuthError(signOutError)) {
          console.error(
            "Ending the other sessions failed:",
            signOutError.name,
            signOutError.status,
          );
        }
        return refused(LOGIN_MESSAGES.technicalProblem);
      }
      // All recovery rows of this user: every other recovery session was just ended with the
      // others, and this one is done. Only a session that is itself in `reset-pending` gets here.
      await db.delete(recoverySessions).where(eq(recoverySessions.userId, state.user.id));
      destination = homePathForRole(state.user.role);
    } else {
      const [updated] = await db
        .update(profiles)
        .set({ invitePending: false, inviteVerifiedAt: null })
        .where(and(eq(profiles.id, state.user.id), eq(profiles.invitePending, true)))
        .returning({ role: profiles.role });
      // No row: a second submit got there first. The password is set either way.
      const role =
        updated?.role ??
        (await db.query.profiles.findFirst({ where: eq(profiles.id, state.user.id) }))?.role ??
        "technician";
      destination = homePathForRole(role);
    }
  } catch (error) {
    // Only the type of the error: the message could contain the password or an address.
    console.error(
      "Setting a password failed unexpectedly:",
      error instanceof Error ? error.name : typeof error,
    );
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  redirect(destination);
}

/**
 * "Annuleren" on G2 in mode reset: leaves the screen without choosing a password and ends the
 * temporary recovery session (decision Jurgen, 25/11/2026, for G2). Like `signOut`, it must
 * always work, so every failure is swallowed: the session cookies are removed in any case, and
 * a row that stays behind is harmless because no session carries its id any more. It reads the
 * state with `getAuthState` first, only to delete the row of this session; a caller in any other
 * state deletes nothing.
 */
export async function cancelPasswordReset(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  let sessionId: string | undefined;
  try {
    const state = await getAuthState();
    if (state.status === "reset-pending") {
      sessionId = state.sessionId;
    }
  } catch (error) {
    console.error(
      "Cancelling a password reset: reading the session failed:",
      error instanceof Error ? error.name : typeof error,
    );
  }
  await endLocalSession(supabase);
  if (sessionId) {
    // After the session has ended, and only the row of this session: another recovery session
    // of the user stays restricted.
    try {
      await getDb().delete(recoverySessions).where(eq(recoverySessions.sessionId, sessionId));
    } catch (error) {
      console.error(
        "Cancelling a password reset: removing the row failed:",
        error instanceof Error ? error.name : typeof error,
      );
    }
  }
  redirect(LOGIN_PATH);
}
