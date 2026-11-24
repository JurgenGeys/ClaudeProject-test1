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

/**
 * Pages that work without a session. `/forgot-password` and `/auth/confirm` are built in
 * BT-06 and BT-06b (design G3 and the invite/reset links); `/set-password` is not listed
 * because it needs the session that `/auth/confirm` creates.
 */
const PUBLIC_PATHS = [LOGIN_PATH, "/forgot-password", "/auth/confirm"];

export function homePathForRole(role: UserRole): string {
  return HOME_PATHS[role];
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * The optimistic access check of the proxy: returns the path to redirect to, or `null`
 * when the request may continue. It only knows whether there is a valid session, not the
 * role or whether the account is active; pages and Server Actions check that (`requireRole`).
 */
export function accessRedirect(request: {
  pathname: string;
  method: string;
  signedIn: boolean;
}): string | null {
  if (!request.signedIn) {
    return isPublicPath(request.pathname) ? null : LOGIN_PATH;
  }
  // Signed-in users do not need the login page. Only a plain page visit is redirected:
  // a form post (for instance from a second tab) still reaches the login action.
  const isPageVisit = request.method === "GET" || request.method === "HEAD";
  if (request.pathname === LOGIN_PATH && isPageVisit) {
    return "/";
  }
  return null;
}
