import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tasks } from "@/db/schema";
import type { InvoiceTaskRef } from "@/lib/validation/invoice";

import { checkTransition, type TaskUser, type TransitionDenial } from "./transitions";
import { taskVersion } from "./version";

/** The part of a Drizzle transaction that is needed here. */
export type InvoiceTransaction = Pick<Database, "select" | "update">;

/** What `markInvoicedInTransaction` did, per task number (each requested task is in exactly one list). */
export type MarkInvoicedOutcome =
  | {
      kind: "done";
      /** Afgewerkt, version as shown: now Gefactureerd. */
      marked: number[];
      /** Gefactureerd already (by this user in another window, or a colleague): nothing is written. */
      alreadyInvoiced: number[];
      /**
       * Not marked: changed since the page was opened (another version: hours corrected, edited,
       * marked and unmarked again), no longer Afgewerkt for another reason, or no such task.
       * One list for all three, because the person has to look at the task again either way.
       */
      changed: number[];
    }
  /** The transition rules refused for a reason that is no fact about one task (role, inactive). */
  | { kind: "refused"; reason: TransitionDenial };

export type MarkInvoicedInput = {
  actor: TaskUser;
  /** Already validated: unique numbers with the version of each. */
  tasks: InvoiceTaskRef[];
};

/**
 * Marks tasks as invoiced (design chapter 4 and 6, `markInvoiced`). Must run inside a
 * transaction, which the caller commits. Per task, not all or nothing: the design says only the
 * Afgewerkt tasks are marked and the rest is reported ("2 taken waren al gefactureerd").
 * 1. all tasks are read with `FOR UPDATE` in one statement, **in the order of the task number**,
 *    so two selections that overlap lock in the same order and cannot deadlock. A simultaneous
 *    correction of hours, edit or marking waits and is then seen;
 * 2. per task: Gefactureerd already is reported and left alone; otherwise `checkTransition`
 *    (Afgewerkt to Gefactureerd by a backoffice user); then the **version**: the page carries the
 *    `updated_at` it was opened with, and a task that moved on since (hours corrected, for
 *    example) is not marked blindly, because the hours that are invoiced must be the hours that
 *    the person saw;
 * 3. one conditional update for the tasks that passed (`status = 'completed'`): status,
 *    `invoiced_by`, `updated_by`, and `invoiced_at` with the clock of the database (the same
 *    moment for the whole selection); `updated_at` comes from the trigger (ADR-0003).
 */
export async function markInvoicedInTransaction(
  tx: InvoiceTransaction,
  input: MarkInvoicedInput,
): Promise<MarkInvoicedOutcome> {
  const { actor } = input;
  const requested = new Map(input.tasks.map((ref) => [ref.number, ref.version]));

  const current = await tx
    .select({
      id: tasks.id,
      number: tasks.number,
      status: tasks.status,
      version: taskVersion,
    })
    .from(tasks)
    .where(inArray(tasks.number, [...requested.keys()]))
    .orderBy(asc(tasks.number))
    .for("update");
  const byNumber = new Map(current.map((row) => [row.number, row]));

  const alreadyInvoiced: number[] = [];
  const changed: number[] = [];
  const eligible: { id: string; number: number }[] = [];

  for (const [number, version] of [...requested].sort((a, b) => a[0] - b[0])) {
    const row = byNumber.get(number);
    if (!row) {
      changed.push(number);
      continue;
    }
    if (row.status === "invoiced") {
      alreadyInvoiced.push(number);
      continue;
    }
    const decision = checkTransition({
      from: row.status,
      to: "invoiced",
      action: "markInvoiced",
      actor,
    });
    if (!decision.allowed) {
      if (decision.reason === "transition_not_allowed" || decision.reason === "wrong_action") {
        // Not Afgewerkt (for a form that was forged, or a status that moved on).
        changed.push(number);
        continue;
      }
      return { kind: "refused", reason: decision.reason };
    }
    if (row.version !== version) {
      changed.push(number);
      continue;
    }
    eligible.push({ id: row.id, number });
  }

  if (eligible.length > 0) {
    const updated = await tx
      .update(tasks)
      .set({
        status: "invoiced",
        invoicedAt: sql`statement_timestamp()`,
        invoicedBy: actor.id,
        updatedBy: actor.id,
      })
      .where(
        and(
          inArray(
            tasks.id,
            eligible.map((row) => row.id),
          ),
          eq(tasks.status, "completed"),
        ),
      )
      .returning({ id: tasks.id });
    if (updated.length !== eligible.length) {
      // Not possible under the lock. Throwing rolls the transaction back.
      throw new Error("markInvoiced: locked tasks were not all updated");
    }
  }

  return {
    kind: "done",
    marked: eligible.map((row) => row.number),
    alreadyInvoiced,
    changed,
  };
}

/** What `unmarkInvoicedInTransaction` did, or why it refused. */
export type UnmarkInvoicedOutcome =
  | { kind: "unmarked"; number: number }
  | { kind: "not-found" }
  /** Not Gefactureerd (any more), or changed after the page was opened (the version differs). */
  | { kind: "changed" }
  | { kind: "refused"; reason: TransitionDenial };

export type UnmarkInvoicedInput = {
  actor: TaskUser;
  number: number;
  /** The `updated_at` the page was opened with. */
  version: string;
};

/**
 * Takes the "Gefactureerd" mark off a task (`unmarkInvoiced`): back to Afgewerkt, with
 * `invoiced_at` and `invoiced_by` wiped (the check constraint wants both gone). The same steps
 * as marking: lock the task, `checkTransition` (Gefactureerd to Afgewerkt), version, then a
 * conditional update. A task that is not Gefactureerd any more (a colleague was first) is
 * "changed", not a silent success: the person sees the real state after reloading.
 */
export async function unmarkInvoicedInTransaction(
  tx: InvoiceTransaction,
  input: UnmarkInvoicedInput,
): Promise<UnmarkInvoicedOutcome> {
  const { actor, number, version } = input;

  const [current] = await tx
    .select({ id: tasks.id, status: tasks.status, version: taskVersion })
    .from(tasks)
    .where(eq(tasks.number, number))
    .for("update");
  if (!current) {
    return { kind: "not-found" };
  }

  const decision = checkTransition({
    from: current.status,
    to: "completed",
    action: "unmarkInvoiced",
    actor,
  });
  if (!decision.allowed) {
    return decision.reason === "transition_not_allowed" || decision.reason === "wrong_action"
      ? { kind: "changed" }
      : { kind: "refused", reason: decision.reason };
  }
  if (current.version !== version) {
    return { kind: "changed" };
  }

  const updated = await tx
    .update(tasks)
    .set({ status: "completed", invoicedAt: null, invoicedBy: null, updatedBy: actor.id })
    .where(and(eq(tasks.id, current.id), eq(tasks.status, "invoiced")))
    .returning({ number: tasks.number });
  const row = updated[0];
  if (!row) {
    // Not possible under the lock. Throwing rolls the transaction back.
    throw new Error("unmarkInvoiced: the locked task was not updated");
  }
  return { kind: "unmarked", number: row.number };
}
