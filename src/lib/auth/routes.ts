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
 * Route handler that the link in the invitation mail points to. It checks the token and
 * sends the visitor on to "set password" (design chapter 6).
 */
export const CONFIRM_PATH = "/auth/confirm";

/** G2: choose a password. The only page an invited user may use before the password is set. */
export const SET_PASSWORD_PATH = "/set-password";

/** Query value of `?mode=` on G2 for the invitation (BT-06b adds `reset`). */
export const SET_PASSWORD_MODE_INVITE = "invite";

/** Query value of `?error=` on G2: the link is invalid, expired or already used. */
export const SET_PASSWORD_ERROR_LINK = "link";

/** Query value of `?error=` on G2: the link could not be checked because Auth was unreachable. */
export const SET_PASSWORD_ERROR_UNAVAILABLE = "unavailable";

/** Where an invited user without a password goes (and where the confirm route sends them). */
export const SET_PASSWORD_INVITE_PATH = `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_INVITE}`;

/**
 * Pages that work without a session. `/auth/clear-session` must be reachable without one:
 * it is where stale session cookies are removed. `/auth/confirm` is where the link in the
 * invitation mail arrives (the visitor has no session yet) and `/set-password` shows the
 * "link is no longer valid" message to visitors without one; the page decides for itself
 * what a visitor may see. `/forgot-password` is added in BT-06b.
 */
const PUBLIC_PATHS = [LOGIN_PATH, CLEAR_SESSION_PATH, CONFIRM_PATH, SET_PASSWORD_PATH];

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
