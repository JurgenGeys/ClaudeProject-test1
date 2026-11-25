import { NextResponse, type NextRequest } from "next/server";

import {
  SET_PASSWORD_ERROR_EXPIRED,
  SET_PASSWORD_MODE_INVITE,
  SET_PASSWORD_PATH,
} from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where a page sends a user whose temporary invitation session is older than 24 hours.
 * Server Components cannot remove cookies, a route handler can: it ends the session and shows
 * "Wachtwoord instellen" with the message that the link has expired.
 *
 * It only signs out when the session really has expired, so a crafted link cannot sign
 * anybody else out. Anyone else is sent on to the start page.
 */
export async function GET(request: NextRequest) {
  const state = await getAuthState();
  if (state.status !== "invite-expired") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  return NextResponse.redirect(
    new URL(
      `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_INVITE}&error=${SET_PASSWORD_ERROR_EXPIRED}`,
      request.url,
    ),
  );
}
