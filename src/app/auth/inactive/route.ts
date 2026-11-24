import { NextResponse, type NextRequest } from "next/server";

import { getAuthState } from "@/lib/auth/session";
import { LOGIN_PATH, LOGIN_REASON_DISABLED } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where a page sends a signed-in user whose account was deactivated (or has no profile).
 * Server Components cannot remove cookies, a route handler can: it ends the session and
 * shows the login page with the message "Je account is uitgeschakeld".
 *
 * It only signs out when the account really is inactive, so a crafted link cannot be used
 * to sign somebody else out. Anyone else is simply sent on to the start page.
 */
export async function GET(request: NextRequest) {
  const state = await getAuthState();
  if (state.status !== "inactive") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set("reason", LOGIN_REASON_DISABLED);
  return NextResponse.redirect(loginUrl);
}
