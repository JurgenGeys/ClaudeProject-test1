/**
 * The temporary session that an invitation link creates may only be used to choose a password,
 * and only for this long after the link was verified (decision Jurgen, 25/11/2026).
 */
export const INVITE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the temporary session of a pending invitation has run out. `verifiedAt` is the
 * moment that the server stored when it verified the link (`profiles.invite_verified_at`),
 * never something the browser sends. A missing moment counts as expired: a pending user
 * without a recorded verification should not have a session at all.
 */
export function isInviteSessionExpired(verifiedAt: Date | null, now: Date): boolean {
  if (!verifiedAt) {
    return true;
  }
  return now.getTime() - verifiedAt.getTime() > INVITE_SESSION_MAX_AGE_MS;
}
