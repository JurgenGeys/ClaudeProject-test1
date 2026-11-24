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
