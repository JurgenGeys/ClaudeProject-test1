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
 * Page that the link in the invitation mail and in the "wachtwoord vergeten" mail points to
 * (`?token_hash=…&type=invite|recovery`). It only shows a button; pressing it checks the token
 * (`confirmLink`) and sends the visitor on to "set password" (design chapter 6).
 */
export const CONFIRM_PATH = "/auth/confirm";

/** G2: choose a password. The only page an invited user may use before the password is set. */
export const SET_PASSWORD_PATH = "/set-password";

/** Query value of `?mode=` on G2 for the invitation. */
export const SET_PASSWORD_MODE_INVITE = "invite";

/** Query value of `?mode=` on G2 after "wachtwoord vergeten" (BT-06b). */
export const SET_PASSWORD_MODE_RESET = "reset";

/** G3: ask for a link to choose a new password. Public. */
export const FORGOT_PASSWORD_PATH = "/forgot-password";

/** Query value of `?error=` on G2: the link is invalid, expired or already used. */
export const SET_PASSWORD_ERROR_LINK = "link";

/** Query value of `?error=` on G2: the link could not be checked because Auth was unreachable. */
export const SET_PASSWORD_ERROR_UNAVAILABLE = "unavailable";

/** Query value of `?error=` on G2: the temporary session of the invitation ran out (24 hours). */
export const SET_PASSWORD_ERROR_EXPIRED = "expired";

/**
 * Route handler that ends the temporary session of an invitation that is older than 24 hours
 * and shows G2 with the message that the link has expired (like `/auth/inactive`).
 */
export const INVITE_EXPIRED_PATH = "/auth/invite-expired";

/**
 * Same as `INVITE_EXPIRED_PATH`, for the temporary session of a "wachtwoord vergeten" link:
 * ends it and shows G2 with "De link is verlopen. Vraag een nieuwe link aan."
 */
export const RESET_EXPIRED_PATH = "/auth/reset-expired";

/** Where an invited user without a password goes (and where the confirm route sends them). */
export const SET_PASSWORD_INVITE_PATH = `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_INVITE}`;

/** Where a user in a recovery session goes: the one page that session may use. */
export const SET_PASSWORD_RESET_PATH = `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_RESET}`;

/**
 * Pages that work without a session. `/auth/clear-session` must be reachable without one:
 * it is where stale session cookies are removed. `/auth/confirm` is where the link in the
 * invitation mail arrives (the visitor has no session yet) and `/set-password` shows the
 * "link is no longer valid" message to visitors without one; the page decides for itself
 * what a visitor may see. `/forgot-password` is where somebody who cannot sign in asks for a link.
 */
const PUBLIC_PATHS = [
  LOGIN_PATH,
  FORGOT_PASSWORD_PATH,
  CLEAR_SESSION_PATH,
  CONFIRM_PATH,
  SET_PASSWORD_PATH,
];

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
