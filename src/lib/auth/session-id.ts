/**
 * The `session_id` claim of a Supabase access token: the id of the Auth session it belongs to.
 * It stays the same when the token is refreshed, so it identifies "this browser's session"
 * (what a recovery session is tied to, see `recovery_sessions`).
 *
 * The token is only decoded here, not verified: callers use a token that Supabase Auth just
 * issued (`verifyOtp`) or just verified (`getUser`). Returns `null` for anything that is not a
 * token with a session id.
 */
export function sessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims && typeof claims === "object" && "session_id" in claims) {
      const id = (claims as { session_id: unknown }).session_id;
      return typeof id === "string" && id.length > 0 ? id : null;
    }
  } catch {
    // Not a JWT: no session id.
  }
  return null;
}
