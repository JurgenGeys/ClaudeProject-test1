import "server-only";

import { cookies } from "next/headers";

import { CLEAR_SESSION_PATH, LOGIN_PATH } from "./routes";

/** Cookies written by `@supabase/ssr` (`sb-<project>-auth-token`, possibly in chunks). */
export function isSessionCookieName(name: string): boolean {
  return name.startsWith("sb-");
}

/**
 * Where to send someone whom the Auth server calls "not signed in". When session cookies
 * are still present (expired or revoked session), the route handler `/auth/clear-session`
 * removes them first, because a Server Component cannot. Otherwise the stale cookies would
 * stay and the proxy would keep treating the visitor as signed in.
 */
export async function pathForSignedOutVisitor(): Promise<string> {
  const hasSessionCookies = (await cookies())
    .getAll()
    .some(({ name }) => isSessionCookieName(name));
  return hasSessionCookies ? CLEAR_SESSION_PATH : LOGIN_PATH;
}

/**
 * Ends the session of this browser for certain. `signOut` tells the Auth server and clears the
 * cookies through the Supabase client, but a temporary Auth error (network, server) can leave
 * the cookies in place, and then the visitor would stay "signed in" (and could loop). So the
 * result is not trusted: whatever happens, the Supabase session cookies are removed here.
 * Works in route handlers and Server Actions (Server Components cannot remove cookies).
 */
export async function endLocalSession(supabase: {
  auth: { signOut(options: { scope: "local" }): PromiseLike<unknown> };
}): Promise<void> {
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
}
