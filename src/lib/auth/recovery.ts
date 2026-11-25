import { INVITE_SESSION_MAX_AGE_MS } from "./invite";

/**
 * The temporary session of a "wachtwoord vergeten" link may only be used to choose a new
 * password, and only for this long after the link was confirmed: the same 24 hours as for an
 * invitation (design chapter 6; decision Jurgen, 25/11/2026 for the invitation, applied to the
 * reset by BT-06b).
 */
export const RESET_SESSION_MAX_AGE_MS = INVITE_SESSION_MAX_AGE_MS;

/**
 * Whether a recovery session has run out. `verifiedAt` is `recovery_sessions.verified_at`, the
 * server time of the click on the button of `/auth/confirm`. A missing moment cannot happen
 * (the column is not null) and counts as expired to be safe.
 */
export function isResetSessionExpired(verifiedAt: Date | null, now: Date): boolean {
  if (!verifiedAt) {
    return true;
  }
  return now.getTime() - verifiedAt.getTime() > RESET_SESSION_MAX_AGE_MS;
}
