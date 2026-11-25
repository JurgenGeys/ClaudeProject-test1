import { isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Network problems, server errors and rate limiting of Supabase Auth: not an answer about the
 * session, the token or the password, so the caller says "try again" instead of "invalid".
 */
export function isTemporaryAuthError(error: { status?: number }): boolean {
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500 || error.status === 429;
}
