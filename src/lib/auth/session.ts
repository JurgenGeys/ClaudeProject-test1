import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db/client";
import { profiles, type UserRole } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 */
export type AuthState =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "unauthenticated" }
  | { status: "inactive" };

export type AuthErrorCode = "unauthenticated" | "inactive" | "forbidden";

/**
 * Thrown by `requireRole`. Callers decide what it means (BT-03 and later):
 * - `unauthenticated`: redirect to `/login`.
 * - `inactive`: sign out and redirect to `/login` with the "account uitgeschakeld" message.
 * - `forbidden`: signed in with the wrong role: show "Deze pagina is niet voor jou bedoeld".
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
  if (error || !data.user) {
    return { status: "unauthenticated" };
  }

  const profile = await getDb().query.profiles.findFirst({
    where: eq(profiles.id, data.user.id),
  });
  if (!profile || !profile.isActive) {
    return { status: "inactive" };
  }

  return {
    status: "authenticated",
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      role: profile.role,
    },
  };
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
export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.status !== "authenticated") {
    throw new AuthError(state.status);
  }
  if (!roles.includes(state.user.role)) {
    throw new AuthError("forbidden");
  }
  return state.user;
}
