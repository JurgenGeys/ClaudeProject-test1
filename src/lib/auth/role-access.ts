import "server-only";

import { redirect } from "next/navigation";

import type { UserRole } from "@/db/schema";

import { INACTIVE_PATH, LOGIN_PATH } from "./routes";
import { AuthError, getCurrentUser, requireRole, type CurrentUser } from "./session";

export type RoleAccess =
  | { kind: "allowed"; user: CurrentUser }
  /** Signed in and active, but with another role than the page is meant for. */
  | { kind: "wrong-role"; user: CurrentUser };

/**
 * Page-level check for Server Components (layouts and pages of a route group). Turns the
 * `AuthError` of `requireRole` into what the design asks for:
 * - not signed in: redirect to `/login`;
 * - deactivated: redirect to the route handler that signs the user out;
 * - wrong role: returned, so the caller can show "Deze pagina is niet voor jou bedoeld".
 *
 * Server Actions do not use this: they turn the `AuthError` into a form error instead.
 */
export async function checkRoleAccess(role: UserRole): Promise<RoleAccess> {
  let failure: AuthError;
  try {
    return { kind: "allowed", user: await requireRole(role) };
  } catch (error) {
    if (!(error instanceof AuthError)) {
      throw error;
    }
    failure = error;
  }

  // `redirect()` throws, so it is called outside the try/catch above.
  if (failure.code === "unauthenticated") {
    redirect(LOGIN_PATH);
  }
  if (failure.code === "inactive") {
    redirect(INACTIVE_PATH);
  }
  const user = await getCurrentUser();
  if (!user) {
    // The session ended between the two lookups.
    redirect(LOGIN_PATH);
  }
  return { kind: "wrong-role", user };
}
