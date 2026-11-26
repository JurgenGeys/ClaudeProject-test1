import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tasks } from "@/db/schema";
import type { ResetTaskData } from "@/lib/validation/reset-task";

import { assigneeProblemOf, lockAssignee, type AssigneeProblem } from "./assignee";
import { checkTransition, type TaskUser } from "./transitions";

/** What `resetTaskInTransaction` did, or why it refused. */
export type ResetTaskOutcome =
  | {
      kind: "reset";
      id: string;
      number: number;
      assigneeName: string;
      /** `2026-11-24` and `08:00:00`, as saved. */
      scheduledDate: string;
      startTime: string;
    }
  /** No task with this number. */
  | { kind: "not-found" }
  /**
   * The task is not Opgepikt (any more): the technician finished it, or it was reset by a
   * colleague, or it was changed after the page was opened (the version differs).
   */
  | { kind: "changed" }
  | AssigneeProblem;

/** The part of a Drizzle transaction that is needed here. */
export type ResetTaskTransaction = Pick<Database, "select" | "update">;

/**
 * Puts an Opgepikt task back to Toegewezen (design B3 "Terugzetten", chapter 4 and 6,
 * `resetTask`): the same or another technician, another date and start time, and the time of
 * picking up is cleared. Must run inside a transaction, which the caller commits. Order of the
 * steps:
 * 1. the task is read with `FOR UPDATE`, so a technician who finishes or picks up at the same
 *    moment, or a colleague who edits, waits until this transaction ends (or makes this one
 *    wait) and is then seen: nothing is overwritten silently. The technician, in turn, gets
 *    "intussen gewijzigd" (BT-12, BT-13);
 * 2. the status is checked again under the lock: only Opgepikt can be reset, otherwise
 *    "changed" (finished, already reset, never picked up). Then the version: the page carries
 *    the `updated_at` it was opened with, and a different value means that someone edited the
 *    task meanwhile ("changed"). The comparison is done by the database on the full
 *    microsecond value;
 * 3. the chosen technician is read with `FOR SHARE` (the rule of BT-07: active, password
 *    chosen) and `checkTransition` (`resetTask`: Opgepikt to Toegewezen, back office, active
 *    technician) decides;
 * 4. a conditional update (`WHERE id AND status = 'picked_up' AND updated_at = version`) sets
 *    Toegewezen, the technician, date and start time, clears `picked_up_at`, and sets
 *    `updated_by`. `updated_at` comes from the trigger (ADR-0003). A `task_completions` row
 *    cannot exist for an Opgepikt task, so nothing happens to it.
 */
export async function resetTaskInTransaction(
  tx: ResetTaskTransaction,
  input: { actor: TaskUser; data: ResetTaskData },
): Promise<ResetTaskOutcome> {
  const { actor, data } = input;

  const [current] = await tx
    .select({
      id: tasks.id,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      versionMatches: sql<boolean>`${tasks.updatedAt} = ${data.version}::timestamptz`,
    })
    .from(tasks)
    .where(eq(tasks.number, data.number))
    .for("update");
  if (!current) {
    return { kind: "not-found" };
  }
  if (current.status !== "picked_up" || !current.versionMatches) {
    return { kind: "changed" };
  }

  const locked = await lockAssignee(tx, data.assigneeId);
  if (!locked) {
    return { kind: "assignee-not-found" };
  }
  const decision = checkTransition({
    from: "picked_up",
    to: "assigned",
    action: "resetTask",
    actor,
    currentAssigneeId: current.assigneeId,
    newAssignee: locked.user,
  });
  if (!decision.allowed) {
    return assigneeProblemOf(decision.reason, locked.fullName);
  }
  if (locked.invitePending) {
    return { kind: "assignee-invited", fullName: locked.fullName };
  }

  const updated = await tx
    .update(tasks)
    .set({
      status: "assigned",
      assigneeId: locked.user.id,
      scheduledDate: data.scheduledDate,
      startTime: data.startTime,
      pickedUpAt: null,
      updatedBy: actor.id,
      // `updated_at` (the version) is set by the database trigger (ADR-0003), not here.
    })
    .where(
      and(
        eq(tasks.id, current.id),
        eq(tasks.status, "picked_up"),
        sql`${tasks.updatedAt} = ${data.version}::timestamptz`,
      ),
    )
    .returning({
      id: tasks.id,
      number: tasks.number,
      scheduledDate: tasks.scheduledDate,
      startTime: tasks.startTime,
    });
  const row = updated[0];
  if (!row) {
    // Not possible under the lock. Throwing rolls the transaction back.
    throw new Error("resetTask: the locked task was not updated");
  }

  return {
    kind: "reset",
    id: row.id,
    number: row.number,
    assigneeName: locked.fullName,
    scheduledDate: row.scheduledDate,
    startTime: row.startTime,
  };
}
