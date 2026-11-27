import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { profiles, tasks } from "@/db/schema";
import type { CancelTaskData } from "@/lib/validation/cancel-task";

import { checkTransition, type TaskUser, type TransitionDenial } from "./transitions";

/** What `cancelTaskInTransaction` did, or why it refused. */
export type CancelTaskOutcome =
  | { kind: "cancelled"; id: string; number: number }
  /** No task with this number. */
  | { kind: "not-found" }
  /**
   * The technician picked the task up meanwhile: he is on his way. The office must call him
   * first and put the task back (Terugzetten) before it can be cancelled (design B3).
   */
  | { kind: "picked-up"; technicianName: string | null }
  /**
   * The task is not Open or Toegewezen any more (finished, invoiced, already cancelled), or it
   * was changed after the page was opened (the version differs).
   */
  | { kind: "changed" }
  /** The transition rules refused for a reason that is no fact about the task (role, inactive). */
  | { kind: "refused"; reason: TransitionDenial };

/** The part of a Drizzle transaction that is needed here. */
export type CancelTaskTransaction = Pick<Database, "select" | "update">;

/**
 * Cancels an Open or Toegewezen task (design B3 "Taak annuleren", chapter 4 and 6, `cancelTask`).
 * Must run inside a transaction, which the caller commits. Order of the steps:
 * 1. the task is read with `FOR UPDATE`, so a technician who picks it up at the same moment, or
 *    a colleague who edits, resets or invoices, waits until this transaction ends (or makes
 *    this one wait) and is then seen. The technician, in turn, is told that the task was
 *    cancelled (BT-12);
 * 2. the status is checked again under the lock. Opgepikt gives "picked-up" (the message of the
 *    design: call him first), any other status that cannot be cancelled (Afgewerkt,
 *    Gefactureerd, already Geannuleerd) gives "changed". Then the version: the page carries the
 *    `updated_at` it was opened with, and a different value means that someone edited the task
 *    meanwhile ("changed"). The comparison is done by the database on the full microsecond
 *    value;
 * 3. `checkTransition` (`cancelTask`: Open or Toegewezen to Geannuleerd, back office, active);
 * 4. a conditional update (`WHERE id AND status AND updated_at = version`) sets Geannuleerd,
 *    `cancelled_by`, `cancelled_at` with the clock of the database, the reason (or nothing) and
 *    `updated_by`. The technician stays on the task for the history (design chapter 5).
 *    `updated_at` comes from the trigger (ADR-0003).
 */
export async function cancelTaskInTransaction(
  tx: CancelTaskTransaction,
  input: { actor: TaskUser; data: CancelTaskData },
): Promise<CancelTaskOutcome> {
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

  if (current.status === "picked_up") {
    // Only the name, for the message. The technician cannot be switched off while he has the
    // task, so the profile is there.
    const [technician] = current.assigneeId
      ? await tx
          .select({ fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.id, current.assigneeId))
      : [];
    return { kind: "picked-up", technicianName: technician?.fullName ?? null };
  }
  if (current.status !== "open" && current.status !== "assigned") {
    return { kind: "changed" };
  }

  const decision = checkTransition({
    from: current.status,
    to: "cancelled",
    action: "cancelTask",
    actor,
    currentAssigneeId: current.assigneeId,
  });
  if (!decision.allowed) {
    return { kind: "refused", reason: decision.reason };
  }
  if (!current.versionMatches) {
    return { kind: "changed" };
  }

  const updated = await tx
    .update(tasks)
    .set({
      status: "cancelled",
      cancelledAt: sql`clock_timestamp()`,
      cancelledBy: actor.id,
      cancellationReason: data.reason,
      updatedBy: actor.id,
      // `updated_at` (the version) is set by the database trigger (ADR-0003), not here.
    })
    .where(
      and(
        eq(tasks.id, current.id),
        eq(tasks.status, current.status),
        sql`${tasks.updatedAt} = ${data.version}::timestamptz`,
      ),
    )
    .returning({ id: tasks.id, number: tasks.number });
  const row = updated[0];
  if (!row) {
    // Not possible under the lock. Throwing rolls the transaction back.
    throw new Error("cancelTask: the locked task was not updated");
  }

  return { kind: "cancelled", id: row.id, number: row.number };
}
