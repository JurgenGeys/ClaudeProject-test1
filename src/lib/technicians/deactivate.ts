import "server-only";

import { and, count, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { profiles, tasks } from "@/db/schema";
import { openAssigneeStatuses } from "@/lib/tasks/types";

/** What `deactivateTechnicianProfile` did, or why it refused. */
export type DeactivateOutcome =
  | { kind: "deactivated"; fullName: string }
  /** No profile with this id, or it is not a technician. */
  | { kind: "not-found" }
  /** Invited, no password chosen yet: design B7 only offers "Uitschakelen" for active technicians. */
  | { kind: "invited"; fullName: string }
  | { kind: "already-disabled"; fullName: string }
  | { kind: "open-tasks"; fullName: string; openTasks: number };

/** The part of a Drizzle transaction that is needed here. */
export type DeactivateTransaction = Pick<Database, "select" | "update">;

/**
 * Switches a technician off in the database (design B7, chapter 5): `is_active = false` and
 * `deactivated_at = now()` (the check constraint `profiles_active_matches_deactivated_at`
 * demands both), unless the technician still has open tasks (Toegewezen or Opgepikt).
 *
 * Must run inside a transaction, which the caller commits. The profile row is locked with
 * `FOR UPDATE` before the open tasks are counted. That closes the race with a task that is being
 * assigned at the same moment: assigning writes `tasks.assignee_id`, whose foreign key takes a
 * `FOR KEY SHARE` lock on this row, which `FOR UPDATE` conflicts with. So either the assignment
 * commits first (and is counted here, so switching off is refused), or this transaction commits
 * first (and the assignment, which must check `is_active` under `FOR SHARE`, sees the
 * technician as switched off). See design chapter 6, "Uitschakelen".
 */
export async function deactivateTechnicianProfile(
  tx: DeactivateTransaction,
  technicianId: string,
): Promise<DeactivateOutcome> {
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
  if (!profile.isActive) {
    return { kind: "already-disabled", fullName: profile.fullName };
  }
  if (profile.invitePending) {
    return { kind: "invited", fullName: profile.fullName };
  }

  const [{ openTasks }] = await tx
    .select({ openTasks: count() })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, profile.id), inArray(tasks.status, [...openAssigneeStatuses])));
  if (openTasks > 0) {
    return { kind: "open-tasks", fullName: profile.fullName, openTasks };
  }

  await tx
    .update(profiles)
    // The database clock, like the other moments that matter for access.
    .set({ isActive: false, deactivatedAt: sql`now()` })
    .where(eq(profiles.id, profile.id));
  return { kind: "deactivated", fullName: profile.fullName };
}
