import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { profiles } from "@/db/schema";

/** What `reactivateTechnicianProfile` did, or why it refused. */
export type ReactivateOutcome =
  | { kind: "reactivated"; fullName: string }
  /** No profile with this id, or it is not a technician (a backoffice id is "not found" too). */
  | { kind: "not-found" }
  /** Not switched off: he is active. */
  | { kind: "already-active"; fullName: string }
  /** Invited, no password chosen yet: such a technician was never switched off. */
  | { kind: "invited"; fullName: string };

/** The part of a Drizzle transaction that is needed here. */
export type ReactivateTransaction = Pick<Database, "select" | "update">;

/**
 * Switches a technician on again in the database (design B7, "Opnieuw activeren", P3):
 * `is_active = true` and `deactivated_at = null` (the check constraint
 * `profiles_active_matches_deactivated_at` demands both). Tasks are not given back.
 *
 * Must run inside a transaction, which the caller commits. The profile row is locked with
 * `FOR UPDATE` first, like `deactivateTechnicianProfile` does, so two screens that switch the same
 * technician off and on cannot interleave.
 *
 * Only a switched-off technician can be switched on. An invited technician (`invite_pending`,
 * active) is refused; a backoffice id or an unknown id is "not found".
 */
export async function reactivateTechnicianProfile(
  tx: ReactivateTransaction,
  technicianId: string,
): Promise<ReactivateOutcome> {
  const [profile] = await tx
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      isActive: profiles.isActive,
      invitePending: profiles.invitePending,
    })
    .from(profiles)
    .where(eq(profiles.id, technicianId))
    .for("update");

  if (!profile || profile.role !== "technician") {
    return { kind: "not-found" };
  }
  if (profile.isActive) {
    return profile.invitePending
      ? { kind: "invited", fullName: profile.fullName }
      : { kind: "already-active", fullName: profile.fullName };
  }

  await tx
    .update(profiles)
    .set({ isActive: true, deactivatedAt: null })
    .where(eq(profiles.id, profile.id));
  return { kind: "reactivated", fullName: profile.fullName };
}
