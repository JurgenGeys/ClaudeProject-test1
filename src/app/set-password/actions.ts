"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { LOGIN_MESSAGES, SET_PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { homePathForRole } from "@/lib/auth/routes";
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
 * Chooses the password of an invited technician (design G2) and signs them in for good.
 * Deliberately no `requireRole`: until the password is chosen, `getAuthState` reports the
 * invited user as `password-pending`, and this is the one action that accepts exactly that
 * state. Anyone else (no session, or a user who already has a password) is refused, so the
 * action cannot be used to change somebody's password without knowing the old one.
 *
 * Order: first the password in Supabase Auth, then `invite_pending = false`. When the second
 * step fails the user is still pending and tries again; Auth then says the password is the
 * same as the current one (`same_password`), which is accepted here: it can only be the
 * password this very session just chose.
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
  if (state.status !== "password-pending") {
    return refused(
      `${SET_PASSWORD_MESSAGES.inviteLinkInvalid} ${SET_PASSWORD_MESSAGES.inviteLinkAdvice}`,
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
          `${SET_PASSWORD_MESSAGES.inviteLinkInvalid} ${SET_PASSWORD_MESSAGES.inviteLinkAdvice}`,
        );
      }
      console.error("Setting a password failed:", error.name, error.code, error.status);
      return refused(LOGIN_MESSAGES.technicalProblem);
    }

    const db = getDb();
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
