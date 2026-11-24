import type { UserRole } from "@/db/schema";

/** Where each role lands after signing in (design chapter 2: T1 and B1). */
const HOME_PATHS: Record<UserRole, string> = {
  technician: "/my-tasks",
  backoffice: "/tasks",
};

export const LOGIN_PATH = "/login";

/**
 * Route handler that signs out a user whose account was deactivated while they were
 * signed in, and then sends them to the login page with the matching message.
 */
export const INACTIVE_PATH = "/auth/inactive";

/** Query parameter on `/login` that explains why the user was sent back. */
export const LOGIN_REASON_DISABLED = "disabled";

export const CLEAR_SESSION_PATH = "/auth/clear-session";

/**
 * Pages that work without a session. `/auth/clear-session` must be reachable without one:
 * it is where stale session cookies are removed. The password pages (`/forgot-password`,
 * `/auth/confirm`) are added in BT-06 and BT-06b, together with the pages themselves.
 */
const PUBLIC_PATHS = [LOGIN_PATH, CLEAR_SESSION_PATH];

export function homePathForRole(role: UserRole): string {
  return HOME_PATHS[role];
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * The optimistic access check of the proxy: returns the path to redirect to, or `null`
 * when the request may continue. It only knows whether the token looks valid, so it only
 * keeps visitors without a session off protected pages. It deliberately does not send
 * signed-in users away from `/login`: the proxy cannot verify the session with the Auth
 * server, so that decision (with `getAuthState`) belongs to the login page. Deciding it
 * here as well could make `/login` and `/` redirect to each other forever.
 */
export function accessRedirect(request: { pathname: string; signedIn: boolean }): string | null {
  if (!request.signedIn && !isPublicPath(request.pathname)) {
    return LOGIN_PATH;
  }
  return null;
}
