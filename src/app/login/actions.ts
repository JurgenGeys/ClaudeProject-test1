"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { homePathForRole } from "@/lib/auth/routes";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { createSupabaseCredentialsClient } from "@/lib/supabase/credentials";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation/login";

export type LoginFieldErrors = { email?: string; password?: string };

/** What the login form shows after a failed attempt. A successful login redirects instead. */
export type LoginState = {
  /** Echoed back so the e-mail field keeps its value (the password is never sent back). */
  email: string;
  fieldErrors: LoginFieldErrors;
  formError?: string;
} | null;

function failure(email: string, formError: string): LoginState {
  return { email, fieldErrors: {}, formError };
}

/**
 * Signs in with e-mail and password (design G1). Order of the checks:
 * 1. Zod validation on the server, even though the form validates too.
 * 2. Supabase Auth checks the credentials. A wrong e-mail address, a wrong password and a
 *    blocked account (`user_banned`) all give the same message.
 * 3. The profile must exist and be active; otherwise the session is ended again and the
 *    same message is shown. Until this point no cookie has been written.
 * 4. The session is written to the cookies.
 * 5. Redirect to the start page of the role.
 */
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: LoginFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "email" || field === "password") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { email: raw.email, fieldErrors };
  }
  const { email, password } = parsed.data;

  // `redirect()` throws, so it must stay outside the try/catch below.
  let destination: string;
  try {
    // Check the password and the profile with a client that keeps nothing, so a refused
    // login leaves the cookies alone (see `createSupabaseCredentialsClient`).
    const verifier = createSupabaseCredentialsClient();
    const { data, error } = await verifier.auth.signInWithPassword({ email, password });

    if (error || !data.user || !data.session) {
      // A blocked account (`user_banned`) gets the same message as a wrong password: the login
      // screen never reveals whether an account exists or is disabled (decision Jurgen, 24/11/2026).
      if (error?.code === "over_request_rate_limit" || error?.status === 429) {
        return failure(email, LOGIN_MESSAGES.tooManyAttempts);
      }
      if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) {
        return failure(email, LOGIN_MESSAGES.technicalProblem);
      }
      return failure(email, LOGIN_MESSAGES.invalidCredentials);
    }

    const profile = await getDb().query.profiles.findFirst({
      where: eq(profiles.id, data.user.id),
    });
    if (!profile || !profile.isActive) {
      // The password was right but the account may not be used: end the session that was just
      // created and give the same message as for a wrong password. "Je account is
      // uitgeschakeld" is only shown to someone who was already signed in (`/auth/inactive`).
      await verifier.auth.signOut({ scope: "local" });
      return failure(email, LOGIN_MESSAGES.invalidCredentials);
    }

    // Allowed: now the session goes into the cookies.
    const supabase = await createSupabaseServerClient();
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (sessionError) {
      return failure(email, LOGIN_MESSAGES.technicalProblem);
    }
    destination = homePathForRole(profile.role);
  } catch (error) {
    // Only the type of the error: the message could contain the e-mail address or password.
    console.error("Login failed unexpectedly:", error instanceof Error ? error.name : typeof error);
    return failure(email, LOGIN_MESSAGES.technicalProblem);
  }

  redirect(destination);
}
