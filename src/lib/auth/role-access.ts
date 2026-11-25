import "server-only";

import { redirect } from "next/navigation";

import type { UserRole } from "@/db/schema";

import { pathForSignedOutVisitor } from "./login-redirect";
import { INACTIVE_PATH, SET_PASSWORD_INVITE_PATH } from "./routes";
import { AuthError, getCurrentUser, requireRole, type CurrentUser } from "./session";

export type RoleAccess =
  | { kind: "allowed"; user: CurrentUser }
  /** Signed in and active, but with another role than the page is meant for. */
  | { kind: "wrong-role"; user: CurrentUser }
  /** Supabase Auth could not be reached: show a technical message, never redirect. */
  | { kind: "unavailable" };

/**
 * Check for Server Components. Every page calls it itself (ADR-0002, rule 3): the layout of a
 * route group also calls it, but only to decide what to show around the page; a layout does
 * not protect the page's own data. Turns the
 * `AuthError` of `requireRole` into what the design asks for:
 * - not signed in: redirect to `/login`;
 * - deactivated: redirect to the route handler that signs the user out;
 * - invited but no password chosen yet: redirect to "set password" (G2);
 * - wrong role: returned, so the caller can show "Deze pagina is niet voor jou bedoeld";
 * - Auth unreachable: returned as `unavailable` (the caller renders nothing or a message).
 *
 * The result is cached per request (`getAuthState`), so layout and page share one lookup.
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
  if (failure.code === "unavailable") {
    return { kind: "unavailable" };
  }
  if (failure.code === "unauthenticated") {
    redirect(await pathForSignedOutVisitor());
  }
  if (failure.code === "inactive") {
    redirect(INACTIVE_PATH);
  }
  if (failure.code === "password-pending") {
    redirect(SET_PASSWORD_INVITE_PATH);
  }
  const user = await getCurrentUser();
  if (!user) {
    // The session ended between the two lookups.
    redirect(await pathForSignedOutVisitor());
  }
  return { kind: "wrong-role", user };
}
