import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
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
 * What the link in the invitation mail carries (the template in `supabase/templates/`):
 * `/auth/confirm?token_hash=...&type=invite`. Only the invitation exists in BT-06; password
 * reset (`type=recovery`) is added in BT-06b.
 */
const querySchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.literal("invite"),
});

/**
 * A redirect with a relative `Location`: the browser resolves it against the address it just
 * opened, so it always stays on that host and the session cookies that were just set apply to
 * it. Nothing from the request (host header, query) ends up in the destination.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    // The request that got us here carried a one-time token; never let anything cache the answer.
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

function invalidLink(error: string): NextResponse {
  return redirectTo(`${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_INVITE}&error=${error}`);
}

/**
 * Checks the token of an invitation and sends the visitor to "Wachtwoord instellen" (G2).
 *
 * `verifyOtp` turns the token into a session (cookies). That session is the "temporary
 * session" of the invitation: the profile of the invited technician has `invite_pending`, so
 * `getAuthState` reports `password-pending` and nothing but the set password page and action
 * accepts it, until the password is chosen.
 *
 * An invitation is only valid for a technician profile that we created and that is still
 * waiting for its password. Anything else (no profile, already accepted, deactivated) is
 * signed out again and treated as an invalid link. The token and the Auth error messages are
 * never logged or put in a redirect: every failure ends on the same page, G2, with a fixed
 * message. All redirects are relative, so they stay on the host that received the request.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    token_hash: request.nextUrl.searchParams.get("token_hash"),
    type: request.nextUrl.searchParams.get("type"),
  });
  if (!parsed.success) {
    return invalidLink(SET_PASSWORD_ERROR_LINK);
  }

  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      type: parsed.data.type,
      token_hash: parsed.data.token_hash,
    });
    if (error || !data.user) {
      // Network problem, server error or rate limit: not an answer about the link. The token
      // may still be good, so the page invites to try again.
      return invalidLink(
        error && isTemporaryAuthError(error)
          ? SET_PASSWORD_ERROR_UNAVAILABLE
          : SET_PASSWORD_ERROR_LINK,
      );
    }

    const profile = await getDb().query.profiles.findFirst({
      where: eq(profiles.id, data.user.id),
    });
    if (!profile || !profile.isActive || !profile.invitePending || profile.role !== "technician") {
      await supabase.auth.signOut({ scope: "local" });
      return invalidLink(SET_PASSWORD_ERROR_LINK);
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
    return invalidLink(SET_PASSWORD_ERROR_UNAVAILABLE);
  }

  return redirectTo(SET_PASSWORD_INVITE_PATH);
}
