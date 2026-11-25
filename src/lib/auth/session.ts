import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db/client";
import { profiles, recoverySessions, type UserRole } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { isInviteSessionExpired } from "./invite";
import { isResetSessionExpired } from "./recovery";
import { isTemporaryAuthError } from "./temporary-error";

/** The signed-in user as the application sees them: Supabase Auth user plus profile. */
export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
};

/**
 * Outcome of looking at the current request:
 * - `authenticated`: valid session and an active profile.
 * - `unauthenticated`: no (valid) session.
 * - `inactive`: valid session, but the profile is missing or deactivated. This user is
 *   treated as refused. Whoever calls this should sign the session out and show the
 *   message "Je account is uitgeschakeld" on the login page (design G1).
 * - `password-pending`: valid session and an active profile, but the invited technician has
 *   not chosen a password yet. The session that the invitation link creates may only be used
 *   for that (design G2); everywhere else this user is treated as not allowed in.
 * - `invite-expired`: as `password-pending`, but the link was verified more than 24 hours ago.
 *   The session is treated as not signed in: the caller ends it and shows "De link is verlopen".
 * - `reset-pending`: valid session and an active profile, but this very session is the temporary
 *   one that a "wachtwoord vergeten" link created (it has a row in `recovery_sessions`). It may only
 *   be used to choose a new password (design G2, mode reset); other sessions of the same user
 *   are not affected. The user is complete (with role) so the action can send them home.
 * - `reset-expired`: as `reset-pending`, but the link was confirmed more than 24 hours ago.
 *   The caller ends the session and shows "De link is verlopen. Vraag een nieuwe link aan."
 * - `unavailable`: Supabase Auth could not be reached (network, server error, rate limit).
 *   This is NOT "signed out": the caller shows a technical message and must not redirect
 *   to the login page, otherwise a short outage would send everybody around in circles.
 */
export type AuthState =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "unauthenticated" }
  | { status: "inactive" }
  | { status: "password-pending"; user: PendingUser }
  | { status: "invite-expired" }
  | { status: "reset-pending"; user: CurrentUser; sessionId: string }
  | { status: "reset-expired"; sessionId: string }
  | { status: "unavailable" };

/** An invited user who still has to choose a password. */
export type PendingUser = Pick<CurrentUser, "id" | "email" | "fullName">;

export type AuthErrorCode =
  | "unauthenticated"
  | "inactive"
  | "password-pending"
  | "invite-expired"
  | "reset-pending"
  | "reset-expired"
  | "forbidden"
  | "unavailable";

/**
 * Thrown by `requireRole`. Callers decide what it means (BT-03 and later):
 * - `unauthenticated`: redirect to `/login`.
 * - `inactive`: sign out and redirect to `/login` with the "account uitgeschakeld" message.
 * - `password-pending`: invited, no password chosen yet: redirect to the "set password" page.
 * - `invite-expired`: the temporary session of the invitation ran out: end it, show the message.
 * - `reset-pending`: a recovery session, only good for choosing a new password: redirect to G2.
 * - `reset-expired`: the recovery session ran out: end it, show the message.
 * - `forbidden`: signed in with the wrong role: show "Deze pagina is niet voor jou bedoeld".
 * - `unavailable`: Auth could not be reached: show a technical message, do not redirect.
 * In a Server Action, turn it into a `{ ok: false, formError }` result instead.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(`Access refused: ${code}`);
    this.name = "AuthError";
    this.code = code;
  }
}

/**
 * Looks up the current user. The identity comes from `supabase.auth.getUser()`, which
 * asks the Auth server to verify the session; the cookie alone is never trusted. The
 * profile is then read through Drizzle. Cached per request, so a layout, a page and an
 * action can all call it without repeating the two lookups.
 *
 * This only reads: it never writes cookies, so it also works in Server Components.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && isTemporaryAuthError(error)) {
    return { status: "unavailable" };
  }
  if (error?.code === "user_banned") {
    // Switching a technician off blocks his Auth account (BT-07). Supabase then refuses a session
    // that is still valid, with this code, before the profile can be read. Someone who held a
    // session is told that the account is disabled (decision Jurgen, 24/11/2026). This never
    // happens when signing in: that goes through `signInWithPassword` and gets the general message.
    return { status: "inactive" };
  }
  if (error || !data.user) {
    return { status: "unauthenticated" };
  }

  const profile = await getDb().query.profiles.findFirst({
    where: eq(profiles.id, data.user.id),
  });
  if (!profile || !profile.isActive) {
    return { status: "inactive" };
  }

  if (profile.invitePending) {
    if (isInviteSessionExpired(profile.inviteVerifiedAt, new Date())) {
      return { status: "invite-expired" };
    }
    return {
      status: "password-pending",
      user: { id: profile.id, email: profile.email, fullName: profile.fullName },
    };
  }

  const user: CurrentUser = {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
  };

  // Does this user have any recovery session at all? Only then is the id of this request's
  // session needed, so normal requests pay for one small query and nothing else.
  const recovering = await getDb()
    .select({ sessionId: recoverySessions.sessionId, verifiedAt: recoverySessions.verifiedAt })
    .from(recoverySessions)
    .where(eq(recoverySessions.userId, profile.id));
  if (recovering.length > 0) {
    // `getClaims` verifies the signature of the access token, which `getUser` just had the Auth
    // server accept, so its `session_id` can be trusted. When it cannot be read, the answer is
    // `unavailable` (never "normal session"): as long as that lasts, every session of this user
    // is blocked while a recovery session exists, which is the safe side of the choice.
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const sessionId = claimsData?.claims.session_id;
    if (claimsError || typeof sessionId !== "string" || sessionId.length === 0) {
      return { status: "unavailable" };
    }
    const own = recovering.find((row) => row.sessionId === sessionId);
    if (own) {
      if (isResetSessionExpired(own.verifiedAt, new Date())) {
        return { status: "reset-expired", sessionId };
      }
      return { status: "reset-pending", user, sessionId };
    }
  }

  return { status: "authenticated", user };
});

/** The signed-in, active user, or `null` for everyone else (also deactivated users). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const state = await getAuthState();
  return state.status === "authenticated" ? state.user : null;
}

/**
 * Returns the current user if they are active and have one of the given roles, otherwise
 * throws an `AuthError`. Every Server Action starts with this (ADR-0002, rule 3).
 */
export async function requireRole(role: UserRole, ...more: UserRole[]): Promise<CurrentUser> {
  const roles = [role, ...more];
  const state = await getAuthState();
  if (state.status !== "authenticated") {
    throw new AuthError(state.status);
  }
  if (!roles.includes(state.user.role)) {
    throw new AuthError("forbidden");
  }
  return state.user;
}
