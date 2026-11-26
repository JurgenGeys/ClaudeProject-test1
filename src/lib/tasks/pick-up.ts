import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tasks } from "@/db/schema";

import { lockAssignee } from "./assignee";
import { checkTransition, type TaskUser, type TransitionDenial } from "./transitions";

/** What `pickUpTaskInTransaction` did, or why it refused. */
export type PickUpOutcome =
  | { kind: "picked-up"; id: string; number: number; pickedUpAt: Date }
  /** His own task was picked up already (second tap, other device): nothing is written. */
  | { kind: "already-picked-up" }
  /**
   * The task does not exist, is not assigned to this technician (any more) or he is not a
   * technician. One outcome for all of them, so a number from somebody else leaks nothing.
   */
  | { kind: "not-assigned" }
  /** The task is his, but the office cancelled it (design T2). */
  | { kind: "cancelled" }
  /**
   * The task is his, but not Toegewezen any more (already picked up, finished) or it was
   * changed after the page was opened (the version differs): he must look at it again.
   */
  | { kind: "changed" }
  /** The technician was switched off in the meantime. */
  | { kind: "inactive" }
  /** The transition rules refused for a reason that has no message of its own. */
  | { kind: "refused"; reason: TransitionDenial };

/** The part of a Drizzle transaction that is needed here. */
export type PickUpTransaction = Pick<Database, "select" | "update">;

/**
 * Picks up a task for a technician (design chapter 4 and 6, `pickUpTask`). Must run inside a
 * transaction, which the caller commits. Order of the steps:
 * 1. the task is read with `FOR UPDATE`, so a simultaneous reset, cancel, reassignment or edit by
 *    the office waits until this transaction ends (or makes this one wait) and is then seen:
 *    nothing is overwritten silently;
 * 2. the task must be assigned to this technician (the id of the session), otherwise
 *    "not-assigned", whatever the reason; then a cancelled task gives "cancelled";
 * 3. the technician's own profile is read with `FOR SHARE` (the rule of BT-07), so a technician
 *    that is switched off meanwhile is refused;
 *    A task that this technician picked up already is a silent success (`already-picked-up`);
 * 4. `checkTransition` (`pickUpTask`: Toegewezen to Opgepikt, own task, active technician);
 *    other picked up tasks of the same technician do not matter (K5);
 * 5. **version**: the page carries the `updated_at` it was opened with. Does it differ, the
 *    office edited the task meanwhile (it can change the customer or the address), so what the
 *    technician confirmed is not what the task is now: "changed". The comparison is done by the
 *    database on the full microsecond value;
 * 6. a conditional update (`WHERE id AND status = 'assigned' AND assignee_id = actor AND
 *    updated_at = version`) sets Opgepikt, `picked_up_at` with the clock of the database and
 *    `updated_by`. `updated_at` comes from the trigger (ADR-0003).
 */
export async function pickUpTaskInTransaction(
  tx: PickUpTransaction,
  input: { actor: TaskUser; number: number; version: string },
): Promise<PickUpOutcome> {
  const { actor, number, version } = input;

  const [current] = await tx
    .select({
      id: tasks.id,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      versionMatches: sql<boolean>`${tasks.updatedAt} = ${version}::timestamptz`,
    })
    .from(tasks)
    .where(eq(tasks.number, number))
    .for("update");
  if (!current || current.assigneeId !== actor.id) {
    return { kind: "not-assigned" };
  }
  if (current.status === "cancelled") {
    return { kind: "cancelled" };
  }

  // The actor as the database has him now, not as the session had him a moment ago.
  const locked = await lockAssignee(tx, actor.id);
  if (!locked || !locked.user.isActive) {
    return { kind: "inactive" };
  }

  if (current.status === "picked_up") {
    // A second tap or another device: the wish is fulfilled. Nothing is updated, so the first
    // `picked_up_at` stays, whatever the version of this page.
    return { kind: "already-picked-up" };
  }

  const decision = checkTransition({
    from: current.status,
    to: "picked_up",
    action: "pickUpTask",
    actor: locked.user,
    currentAssigneeId: current.assigneeId,
  });
  if (!decision.allowed) {
    switch (decision.reason) {
      case "not_assignee":
        return { kind: "not-assigned" };
      case "actor_inactive":
        return { kind: "inactive" };
      case "transition_not_allowed":
      case "wrong_action":
        // Picked up (by this technician, on another device) or finished already: from
        // `picked_up` the rules know "same status" only as an edit, hence `wrong_action`.
        return { kind: "changed" };
      default:
        return { kind: "refused", reason: decision.reason };
    }
  }
  if (!current.versionMatches) {
    return { kind: "changed" };
  }

  const updated = await tx
    .update(tasks)
    .set({
      status: "picked_up",
      pickedUpAt: sql`clock_timestamp()`,
      updatedBy: actor.id,
      // `updated_at` (the version) is set by the database trigger (ADR-0003), not here.
    })
    .where(
      and(
        eq(tasks.id, current.id),
        eq(tasks.status, "assigned"),
        eq(tasks.assigneeId, actor.id),
        sql`${tasks.updatedAt} = ${version}::timestamptz`,
      ),
    )
    .returning({ id: tasks.id, number: tasks.number, pickedUpAt: tasks.pickedUpAt });
  const row = updated[0];
  if (!row || !row.pickedUpAt) {
    // Not possible under the lock. Throwing rolls the transaction back.
    throw new Error("pickUpTask: the locked task was not updated");
  }

  return { kind: "picked-up", id: row.id, number: row.number, pickedUpAt: row.pickedUpAt };
}
