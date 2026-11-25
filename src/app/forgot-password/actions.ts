"use server";

import { eq, sql } from "drizzle-orm";
import { after } from "next/server";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { getInviteRedirectUrl } from "@/lib/site-url";
import { createSupabaseCredentialsClient } from "@/lib/supabase/credentials";
import { forgotPasswordSchema } from "@/lib/validation/forgot-password";

export type ForgotPasswordState =
  | null
  /** The one answer for every address that passed the format check. */
  | { sent: true }
  | { sent: false; email: string; fieldErrors: { email?: string } };

/** Only the kind of problem: the message of an error can contain an e-mail address. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const { name, code, status } = error as { name?: string; code?: unknown; status?: unknown };
    return [name, code, status].filter((part) => part !== undefined).join(" ");
  }
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Asks for a link to choose a new password (design G3). Public: anybody can post to it, so the
 * answer must never tell who is known. The rules:
 * - A malformed address gets a field error (that says nothing about any account).
 * - Every other address gets exactly the same answer: `{ sent: true }`, whether the address
 *   exists, belongs to an active user, is disabled, or Supabase refuses to send (rate limit).
 * - The work itself runs after the response (`after`), so the answer is not faster for an
 *   address that is unknown than for one that gets a mail (a visible difference in time would
 *   tell the same thing). Failures are therefore only logged, never shown.
 * - A mail is only requested for a profile that exists and is active. A disabled user gets no
 *   mail at all (the screen looks the same), and an Auth account without a profile gets none
 *   either. Disabled users are also blocked in Supabase Auth (BT-07), and `/auth/confirm`
 *   refuses their link as well, so this is the third layer.
 * - The link in the mail goes to `<SITE_URL>/auth/confirm` (never built from the request), where
 *   the visitor has to press a button before the token is used.
 */
export async function requestPasswordReset(
  _previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const raw = String(formData.get("email") ?? "");
  const parsed = forgotPasswordSchema.safeParse({ email: raw });
  if (!parsed.success) {
    return { sent: false, email: raw, fieldErrors: { email: parsed.error.issues[0]?.message } };
  }
  const { email } = parsed.data;

  after(async () => {
    try {
      const profile = await getDb().query.profiles.findFirst({
        where: eq(sql`lower(${profiles.email})`, email),
      });
      if (!profile || !profile.isActive) {
        return;
      }
      // A client that keeps nothing: no session or cookie is created by asking for a mail.
      const { error } = await createSupabaseCredentialsClient().auth.resetPasswordForEmail(
        profile.email,
        { redirectTo: getInviteRedirectUrl() },
      );
      if (error) {
        if (error.status === 429 || error.code === "over_email_send_rate_limit") {
          // The one-minute interval per address or the hourly limit of the project. Not shown:
          // it would tell that the address exists.
          console.warn("A password reset mail was not sent: rate limit of Supabase Auth.");
        } else {
          console.error("Requesting a password reset mail failed:", describeError(error));
        }
      }
    } catch (error) {
      console.error("Requesting a password reset mail failed unexpectedly:", describeError(error));
    }
  });

  return { sent: true };
}
