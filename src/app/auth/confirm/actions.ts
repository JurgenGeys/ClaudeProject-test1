"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import {
  SET_PASSWORD_ERROR_LINK,
  SET_PASSWORD_ERROR_UNAVAILABLE,
  SET_PASSWORD_INVITE_PATH,
  SET_PASSWORD_MODE_INVITE,
  SET_PASSWORD_PATH,
} from "@/lib/auth/routes";
import { isTemporaryAuthError } from "@/lib/auth/temporary-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * What the button on `/auth/confirm` sends back: the token of the link and its type. `invite` is
 * the first invitation mail; `recovery` is the mail that "Uitnodiging opnieuw versturen" sends
 * to someone who already opened the first link (Supabase only sends an invitation to an address
 * it has not confirmed yet). In BT-06 both are only accepted for a technician who still has to
 * choose a password; BT-06b opens `recovery` for "Wachtwoord vergeten".
 */
const confirmSchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(["invite", "recovery"]),
});

function invalidLinkPath(error: string): string {
  return `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_INVITE}&error=${error}`;
}

/**
 * Verifies the token of an invitation (design G2) and sends the visitor to "Wachtwoord
 * instellen". This runs only when the visitor presses the button on `/auth/confirm`, never
 * when the link is opened: mail scanners and link previews fetch the link with a GET and must
 * not use up the one-time token (decision Jurgen, 25/11/2026).
 *
 * `verifyOtp` turns the token into a session (cookies): the temporary session of the
 * invitation. The profile has `invite_pending`, so `getAuthState` reports `password-pending`
 * and nothing but the set password page and action accepts it. The server stores the moment
 * of verification in `profiles.invite_verified_at`; 24 hours later the session counts as
 * expired. A link is only valid for a technician profile that still waits for its password;
 * anything else (no profile, already accepted, deactivated) is signed out again and treated as
 * an invalid link.
 *
 * The token and the Auth error messages are never logged or put in a redirect: every failure
 * ends on G2 with a fixed message. All redirects are relative, so they stay on the host that
 * received the request and the session cookies that were just set apply to it.
 */
export async function confirmInvite(formData: FormData): Promise<void> {
  const parsed = confirmSchema.safeParse({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    redirect(invalidLinkPath(SET_PASSWORD_ERROR_LINK));
  }

  // `redirect()` throws, so it is only called after the try/catch below.
  let destination: string;
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      type: parsed.data.type,
      token_hash: parsed.data.token_hash,
    });
    if (error || !data.user) {
      // Network problem, server error or rate limit: not an answer about the link. The token
      // may still be good, so the page invites to try again.
      destination = invalidLinkPath(
        error && isTemporaryAuthError(error)
          ? SET_PASSWORD_ERROR_UNAVAILABLE
          : SET_PASSWORD_ERROR_LINK,
      );
    } else {
      const db = getDb();
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, data.user.id),
      });
      if (
        !profile ||
        !profile.isActive ||
        !profile.invitePending ||
        profile.role !== "technician"
      ) {
        await supabase.auth.signOut({ scope: "local" });
        destination = invalidLinkPath(SET_PASSWORD_ERROR_LINK);
      } else {
        // Database time, so the 24 hours run on a clock that the visitor cannot touch.
        await db
          .update(profiles)
          .set({ inviteVerifiedAt: sql`now()` })
          .where(eq(profiles.id, profile.id));
        destination = SET_PASSWORD_INVITE_PATH;
      }
    }
  } catch (error) {
    // Only the kind of error: its message could hold the token or an e-mail address.
    console.error(
      "Confirming an invitation failed:",
      error instanceof Error ? error.name : typeof error,
    );
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Nothing more to do; the page shows the message either way.
    }
    destination = invalidLinkPath(SET_PASSWORD_ERROR_UNAVAILABLE);
  }
  redirect(destination);
}
