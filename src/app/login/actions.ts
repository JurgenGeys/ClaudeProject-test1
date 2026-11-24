"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { homePathForRole } from "@/lib/auth/routes";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
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
 * 2. Supabase Auth checks the credentials. A wrong e-mail address and a wrong password
 *    give the same message; a blocked account (`user_banned`) gets the disabled message.
 * 3. The profile must exist and be active; otherwise the session is removed again.
 * 4. Redirect to the start page of the role.
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
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      if (error?.code === "user_banned") {
        return failure(email, LOGIN_MESSAGES.accountDisabled);
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
      // The password was right but the account may not be used: remove the session again.
      await supabase.auth.signOut({ scope: "local" });
      return failure(email, LOGIN_MESSAGES.accountDisabled);
    }
    destination = homePathForRole(profile.role);
  } catch {
    return failure(email, LOGIN_MESSAGES.technicalProblem);
  }

  redirect(destination);
}
