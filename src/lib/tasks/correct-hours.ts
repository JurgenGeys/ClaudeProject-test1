import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { taskCompletions, tasks } from "@/db/schema";
import type { CorrectHoursData } from "@/lib/validation/hours-correction";

import { checkTransition, type TaskUser, type TransitionDenial } from "./transitions";

/** What `correctHoursInTransaction` did, or why it refused. */
export type CorrectHoursOutcome =
  | { kind: "corrected"; id: string; number: number; correctedMinutes: number }
  /** No task with this number. */
  | { kind: "not-found" }
  /** The task is Gefactureerd: the hours are locked until the mark is taken off (design B3). */
  | { kind: "invoiced" }
  /**
   * The task is not Afgewerkt (any more, or not yet), or it was changed after the page was opened
   * (the version differs: edited, corrected by a colleague, marked and unmarked again).
   */
  | { kind: "changed" }
  /** The transition rules refused for a reason that is no fact about the task (role, inactive). */
  | { kind: "refused"; reason: TransitionDenial };

/** The part of a Drizzle transaction that is needed here. */
export type CorrectHoursTransaction = Pick<Database, "select" | "update">;

/**
 * Corrects the hours of an Afgewerkt task (design B3 "Uren corrigeren", chapter 4 and 6,
 * `correctHours`). Must run inside a transaction, which the caller commits. The hours of the
 * technician (`worked_minutes`) are never overwritten (assumption A19): the correction is written
 * next to them, with the reason, who and when. Order of the steps:
 * 1. the task is read with `FOR UPDATE`, so a simultaneous "Markeer als gefactureerd" (BT-17), a
 *    second correction or an edit waits until this transaction ends (or makes this one wait) and
 *    is then seen. Marking, in turn, finds a different version and reports the task as changed;
 * 2. the status is checked again under the lock: only Afgewerkt can be corrected. Gefactureerd is
 *    locked ("invoiced"); any other status is "changed". Then `checkTransition` (`correctHours`:
 *    Afgewerkt to Afgewerkt, back office, valid hours, a reason);
 * 3. the version: the page carries the `updated_at` it was opened with, and a different value
 *    means that someone changed the task meanwhile ("changed"). The database compares the full
 *    microsecond value. Two corrections from the same page: the second one is "changed";
 * 4. **the task row is updated** (`updated_by`), so that the trigger of ADR-0003 moves
 *    `updated_at`. Without this the version of the task would stay the same and "Markeer als
 *    gefactureerd" could not see a correction made after its list was opened (BT-17);
 * 5. the correction is written on the row of `task_completions`: hours, reason, `corrected_by`
 *    and `corrected_at` (the clock of the database). All four come together (check constraint).
 *    A correction of a task that was corrected before replaces that correction; the original
 *    hours stay.
 */
export async function correctHoursInTransaction(
  tx: CorrectHoursTransaction,
  input: { actor: TaskUser; data: CorrectHoursData },
): Promise<CorrectHoursOutcome> {
  const { actor, data } = input;

  const [current] = await tx
    .select({
      id: tasks.id,
      status: tasks.status,
      versionMatches: sql<boolean>`${tasks.updatedAt} = ${data.version}::timestamptz`,
    })
    .from(tasks)
    .where(eq(tasks.number, data.number))
    .for("update");
  if (!current) {
    return { kind: "not-found" };
  }

  const decision = checkTransition({
    from: current.status,
    to: "completed",
    action: "correctHours",
    actor,
    correctedMinutes: data.correctedMinutes,
    correctionReason: data.reason,
  });
  if (!decision.allowed) {
    if (decision.reason === "transition_not_allowed" || decision.reason === "wrong_action") {
      return current.status === "invoiced" ? { kind: "invoiced" } : { kind: "changed" };
    }
    return { kind: "refused", reason: decision.reason };
  }
  if (!current.versionMatches) {
    return { kind: "changed" };
  }

  const touched = await tx
    .update(tasks)
    .set({
      updatedBy: actor.id,
      // `updated_at` (the version) is set by the database trigger (ADR-0003), not here.
    })
    .where(
      and(
        eq(tasks.id, current.id),
        eq(tasks.status, "completed"),
        sql`${tasks.updatedAt} = ${data.version}::timestamptz`,
      ),
    )
    .returning({ id: tasks.id, number: tasks.number });
  const row = touched[0];
  if (!row) {
    // Not possible under the lock. Throwing rolls the transaction back.
    throw new Error("correctHours: the locked task was not updated");
  }

  const corrected = await tx
    .update(taskCompletions)
    .set({
      correctedMinutes: data.correctedMinutes,
      correctionReason: data.reason,
      correctedBy: actor.id,
      correctedAt: sql`clock_timestamp()`,
    })
    .where(eq(taskCompletions.taskId, row.id))
    .returning({ id: taskCompletions.id });
  if (corrected.length !== 1) {
    // An Afgewerkt task without its completion: the data is wrong. Rolls the transaction back.
    throw new Error("correctHours: the task has no completion to correct");
  }

  return {
    kind: "corrected",
    id: row.id,
    number: row.number,
    correctedMinutes: data.correctedMinutes,
  };
}
