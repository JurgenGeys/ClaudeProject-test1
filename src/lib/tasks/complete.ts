import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { taskCompletions, tasks } from "@/db/schema";

import { lockAssignee } from "./assignee";
import { checkTransition, type TaskUser, type TransitionDenial } from "./transitions";

/** What `completeTaskInTransaction` did, or why it refused. */
export type CompleteOutcome =
  | { kind: "completed"; id: string; number: number; completedAt: Date }
  /**
   * His own task was completed already with exactly these hours and notes (a double tap, a
   * second device, a retry after a lost answer): nothing is written.
   */
  | { kind: "already-completed" }
  /**
   * The task does not exist, is not assigned to this technician (any more) or he is not a
   * technician. One outcome for all of them, so a number from somebody else leaks nothing.
   */
  | { kind: "not-assigned" }
  /** The task is his, but the office cancelled it. */
  | { kind: "cancelled" }
  /**
   * The task is his, but not Opgepikt any more (reset by the office, or completed with other
   * hours or notes), or it was changed after the page was opened (the version differs).
   */
  | { kind: "changed" }
  /** The technician was switched off in the meantime. */
  | { kind: "inactive" }
  /** The transition rules refused for a reason that has no message of its own. */
  | { kind: "refused"; reason: TransitionDenial };

/** The part of a Drizzle transaction that is needed here. */
export type CompleteTransaction = Pick<Database, "select" | "update" | "insert">;

export type CompleteInput = {
  actor: TaskUser;
  number: number;
  /** The `updated_at` the page was opened with. */
  version: string;
  /** Already validated: a multiple of 15, from 15 to 960 (`completionSchema`). */
  workedMinutes: number;
  /** Already validated and trimmed; `null` for no notes. */
  notes: string | null;
};

/**
 * Completes a task for a technician (design chapter 4 and 6, `completeTask`). Must run inside a
 * transaction, which the caller commits. The same order of steps as `pickUpTaskInTransaction`:
 * 1. the task is read with `FOR UPDATE`, so a simultaneous reset, cancel, reassignment or edit by
 *    the office waits until this transaction ends (or makes this one wait) and is then seen:
 *    nothing is overwritten silently;
 * 2. the task must be assigned to this technician (the id of the session), otherwise
 *    "not-assigned", whatever the reason; then a cancelled task gives "cancelled";
 * 3. the technician's own profile is read with `FOR SHARE` (the rule of BT-07), so a technician
 *    that is switched off meanwhile is refused;
 * 4. **a task that is completed already** (Afgewerkt or Gefactureerd, by him): the same hours and
 *    notes are a silent success (`already-completed`, nothing is written, so there is never a
 *    second `task_completions` row); other hours or notes are "changed", because a silent
 *    "thank you" would hide that what he typed was thrown away. The page then shows what was
 *    saved. The unique `task_id` of the table is the last safety net;
 * 5. `checkTransition` (`completeTask`: Opgepikt to Afgewerkt, own task, active technician,
 *    hours of a whole number of quarters above 0);
 * 6. **version**: the page carries the `updated_at` it was opened with. Does it differ, the
 *    office edited the task meanwhile (date, address, instructions): "changed", and the page
 *    keeps what he typed while he looks at the task again;
 * 7. the task becomes Afgewerkt (a conditional update: `status = 'picked_up'`, own `assignee_id`,
 *    version) with `updated_by`; `updated_at` comes from the trigger (ADR-0003). Then the row
 *    of `task_completions` is inserted with `completed_at` from the clock of the database.
 */
export async function completeTaskInTransaction(
  tx: CompleteTransaction,
  input: CompleteInput,
): Promise<CompleteOutcome> {
  const { actor, number, version, workedMinutes, notes } = input;

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

  if (current.status === "completed" || current.status === "invoiced") {
    const [existing] = await tx
      .select({ workedMinutes: taskCompletions.workedMinutes, notes: taskCompletions.notes })
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, current.id));
    return existing && existing.workedMinutes === workedMinutes && existing.notes === notes
      ? { kind: "already-completed" }
      : { kind: "changed" };
  }

  const decision = checkTransition({
    from: current.status,
    to: "completed",
    action: "completeTask",
    actor: locked.user,
    currentAssigneeId: current.assigneeId,
    workedMinutes,
  });
  if (!decision.allowed) {
    switch (decision.reason) {
      case "not_assignee":
        return { kind: "not-assigned" };
      case "actor_inactive":
        return { kind: "inactive" };
      case "transition_not_allowed":
      case "wrong_action":
        // Reset to Toegewezen by the office meanwhile (or never picked up).
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
      status: "completed",
      updatedBy: actor.id,
      // `updated_at` (the version) is set by the database trigger (ADR-0003), not here.
    })
    .where(
      and(
        eq(tasks.id, current.id),
        eq(tasks.status, "picked_up"),
        eq(tasks.assigneeId, actor.id),
        sql`${tasks.updatedAt} = ${version}::timestamptz`,
      ),
    )
    .returning({ id: tasks.id, number: tasks.number });
  const row = updated[0];
  if (!row) {
    // Not possible under the lock. Throwing rolls the transaction back.
    throw new Error("completeTask: the locked task was not updated");
  }

  const [completion] = await tx
    .insert(taskCompletions)
    .values({
      taskId: row.id,
      workedMinutes,
      notes,
      completedBy: actor.id,
      completedAt: sql`clock_timestamp()`,
    })
    .returning({ completedAt: taskCompletions.completedAt });

  return { kind: "completed", id: row.id, number: row.number, completedAt: completion.completedAt };
}
