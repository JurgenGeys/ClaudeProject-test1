import { NextResponse, type NextRequest } from "next/server";

import { endLocalSession } from "@/lib/auth/login-redirect";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Removes session cookies that the Auth server no longer accepts (expired or revoked
 * session) and shows the login page. Server Components cannot remove cookies, a route
 * handler can. It only acts when the visitor really is "not signed in": for anyone else
 * (or when Auth cannot be reached) it does nothing, so it cannot be abused to sign somebody
 * out and a short outage cannot wipe valid sessions.
 */
export async function GET(request: NextRequest) {
  const state = await getAuthState();
  if (state.status !== "unauthenticated") {
    const target = state.status === "unavailable" ? LOGIN_PATH : "/";
    return NextResponse.redirect(new URL(target, request.url));
  }

  await endLocalSession(await createSupabaseServerClient());
  return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
}
