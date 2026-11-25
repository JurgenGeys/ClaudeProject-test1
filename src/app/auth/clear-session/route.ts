import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { isSessionCookieName } from "@/lib/auth/login-redirect";
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

  const supabase = await createSupabaseServerClient();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The cookies are removed below either way.
  }
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (isSessionCookieName(name)) {
      cookieStore.delete(name);
    }
  }
  return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
}
