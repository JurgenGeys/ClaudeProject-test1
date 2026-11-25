"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { endLocalSession } from "@/lib/auth/login-redirect";
import {
  SET_PASSWORD_ERROR_LINK,
  SET_PASSWORD_ERROR_UNAVAILABLE,
  SET_PASSWORD_INVITE_PATH,
  SET_PASSWORD_MODE_INVITE,
  SET_PASSWORD_MODE_RESET,
  SET_PASSWORD_PATH,
  SET_PASSWORD_RESET_PATH,
} from "@/lib/auth/routes";
import { sessionIdFromAccessToken } from "@/lib/auth/session-id";
import { isTemporaryAuthError } from "@/lib/auth/temporary-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * What the button on `/auth/confirm` sends back: the token of the link and its type.
 * - `invite`: the first invitation mail.
 * - `recovery`: Supabase's mail for a password reset. It is sent for "Wachtwoord vergeten"
 *   (G3, BT-06b) and also by "Uitnodiging opnieuw versturen" to a technician who already opened
 *   the first link (Supabase only sends an invitation to an address it has not confirmed yet).
 */
const confirmSchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(["invite", "recovery"]),
});

function invalidLinkPath(mode: string, error: string): string {
  return `${SET_PASSWORD_PATH}?mode=${mode}&error=${error}`;
}

/**
 * Verifies the token of a link from a mail (invitation or password reset, design G2) and sends
 * the visitor to "Wachtwoord instellen". This runs only when the visitor presses the button on
 * `/auth/confirm`, never when the link is opened: mail scanners and link previews fetch the link
 * with a GET and must not use up the one-time token (decision Jurgen, 25/11/2026).
 *
 * `verifyOtp` turns the token into a session (cookies): a temporary session that may only be
 * used to choose a password. What kind depends on the profile, never on what the visitor sends:
 * - a technician with `invite_pending` (type `invite` or `recovery`): the invitation session.
 *   The server stores the moment in `profiles.invite_verified_at`; `getAuthState` reports
 *   `password-pending`. Goes to G2 in mode invite.
 * - any other active user, type `recovery` only: the recovery session (BT-06b). The server
 *   stores this very session (`session_id` of the new token) and the moment in
 *   `profiles.recovery_session_id` and `recovery_verified_at`; `getAuthState` reports
 *   `reset-pending` for that session only (other sessions of the user are not touched). Goes to
 *   G2 in mode reset.
 * Both end 24 hours after this moment. Anything else (no profile, deactivated, an `invite` link
 * for somebody who already has a password) is signed out again and treated as an invalid link,
 * so a disabled user gets the same general message as a link that does not exist.
 *
 * The token and the Auth error messages are never logged or put in a redirect: every failure
 * ends on G2 with a fixed message. All redirects are relative, so they stay on the host that
 * received the request and the session cookies that were just set apply to it.
 */
export async function confirmLink(formData: FormData): Promise<void> {
  // The words of the "invalid link" message: for a reset link "Vraag een nieuwe link aan".
  const mode =
    formData.get("type") === "recovery" ? SET_PASSWORD_MODE_RESET : SET_PASSWORD_MODE_INVITE;
  const parsed = confirmSchema.safeParse({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    redirect(invalidLinkPath(mode, SET_PASSWORD_ERROR_LINK));
  }
  const { type, token_hash: tokenHash } = parsed.data;

  // `redirect()` throws, so it is only called after the try/catch below.
  let destination: string;
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error || !data.user) {
      // Network problem, server error or rate limit: not an answer about the link. The token
      // may still be good, so the page invites to try again.
      destination = invalidLinkPath(
        mode,
        error && isTemporaryAuthError(error)
          ? SET_PASSWORD_ERROR_UNAVAILABLE
          : SET_PASSWORD_ERROR_LINK,
      );
    } else {
      const db = getDb();
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, data.user.id),
      });
      const sessionId = sessionIdFromAccessToken(data.session?.access_token);

      if (!profile || !profile.isActive) {
        // A refused user must not keep the session that verifying just created, also not when
        // Auth cannot be reached for the sign-out.
        await endLocalSession(supabase);
        destination = invalidLinkPath(mode, SET_PASSWORD_ERROR_LINK);
      } else if (profile.invitePending) {
        if (profile.role !== "technician") {
          await endLocalSession(supabase);
          destination = invalidLinkPath(mode, SET_PASSWORD_ERROR_LINK);
        } else {
          // Database time, so the 24 hours run on a clock that the visitor cannot touch.
          await db
            .update(profiles)
            .set({ inviteVerifiedAt: sql`now()` })
            .where(eq(profiles.id, profile.id));
          destination = SET_PASSWORD_INVITE_PATH;
        }
      } else if (type === "recovery" && sessionId) {
        await db
          .update(profiles)
          .set({ recoverySessionId: sessionId, recoveryVerifiedAt: sql`now()` })
          .where(eq(profiles.id, profile.id));
        destination = SET_PASSWORD_RESET_PATH;
      } else {
        // An invitation link for somebody who already has a password, or a token without a
        // session id (cannot be tied to a session, so it cannot be restricted).
        await endLocalSession(supabase);
        destination = invalidLinkPath(mode, SET_PASSWORD_ERROR_LINK);
      }
    }
  } catch (error) {
    // Only the kind of error: its message could hold the token or an e-mail address.
    console.error("Confirming a link failed:", error instanceof Error ? error.name : typeof error);
    await endLocalSession(supabase);
    destination = invalidLinkPath(mode, SET_PASSWORD_ERROR_UNAVAILABLE);
  }
  redirect(destination);
}
