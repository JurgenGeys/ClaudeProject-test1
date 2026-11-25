import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tasks } from "@/db/schema";
import type { UpdateTaskData } from "@/lib/validation/update-task";

import { assigneeProblemOf, lockAssignee, type AssigneeProblem } from "./assignee";
import { customerExists, resolveCustomerId } from "./customer";
import { canEditTask, checkTransition, type TaskUser } from "./transitions";
import type { TaskStatus } from "./types";

/** What `updateTaskInTransaction` did, or why it refused. */
export type UpdateTaskOutcome =
  | {
      kind: "updated";
      id: string;
      number: number;
      status: Extract<TaskStatus, "open" | "assigned" | "picked_up">;
    }
  /** No task with this number. */
  | { kind: "not-found" }
  /** Afgewerkt, Gefactureerd or Geannuleerd: there is no editing any more (design B2). */
  | { kind: "not-editable"; status: TaskStatus }
  /** Somebody else saved or moved the task after this form was opened (lost update). */
  | { kind: "changed" }
  | { kind: "customer-not-found" }
  /** A technician was chosen for a picked up task: only Terugzetten can change him. */
  | { kind: "assignee-locked" }
  | AssigneeProblem;

/** The part of a Drizzle transaction that is needed here. */
export type UpdateTaskTransaction = Pick<Database, "select" | "insert" | "update">;

/**
 * Saves the changes to a task (design B2 in edit mode, chapter 4 and 6). Must run inside a
 * transaction, which the caller commits. Order of the steps:
 * 1. the task is read with `FOR UPDATE`, so a second edit, `pickUpTask` or `cancelTask` on the
 *    same task waits until this transaction ends and then sees the result;
 * 2. the status is checked again under the lock: only Open, Toegewezen and Opgepikt can be
 *    edited (`canEditTask`);
 * 3. **version check against lost updates**: the form carries the `updated_at` the page was
 *    opened with. When the task has another `updated_at` now, someone else changed it in the
 *    meantime and nothing is saved ("Deze taak is intussen gewijzigd"). The comparison is
 *    done by the database on the full microsecond value, not on a rounded JavaScript date.
 *    The trigger of ADR-0003 sets `updated_at` on every update, whoever writes, so no
 *    writer can forget it;
 * 4. a chosen existing customer must exist; the technician (Open and Toegewezen only) is read
 *    with `FOR SHARE` and checked like in `createTaskInTransaction`. On a picked up task the
 *    technician and `picked_up_at` never change: another technician is refused;
 * 5. `checkTransition` (`updateTask`), then the new customer if there is one, then a
 *    conditional update (`WHERE id AND status AND updated_at = version`). With a technician the
 *    task becomes Toegewezen, without one Open (P2); an Opgepikt task stays Opgepikt.
 *    `updated_by` is the actor, `updated_at` comes from the trigger.
 */
export async function updateTaskInTransaction(
  tx: UpdateTaskTransaction,
  input: { actor: TaskUser; data: UpdateTaskData },
): Promise<UpdateTaskOutcome> {
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
  if (!canEditTask(current.status)) {
    return { kind: "not-editable", status: current.status };
  }
  if (!current.versionMatches) {
    return { kind: "changed" };
  }

  if (data.customer.kind === "existing" && !(await customerExists(tx, data.customer.id))) {
    return { kind: "customer-not-found" };
  }

  const pickedUp = current.status === "picked_up";
  let status: "open" | "assigned" | "picked_up" = "picked_up";
  let assigneeId = current.assigneeId;

  if (pickedUp) {
    // The technician is not changed here. The disabled select sends nothing; anything else
    // than the current technician is a forged form, which the transition rules refuse.
    const decision = checkTransition({
      from: "picked_up",
      to: "picked_up",
      action: "updateTask",
      actor,
      currentAssigneeId: current.assigneeId,
      newAssignee: data.assigneeId
        ? { id: data.assigneeId, role: "technician", isActive: true }
        : undefined,
    });
    if (!decision.allowed) {
      return decision.reason === "assignee_locked"
        ? { kind: "assignee-locked" }
        : { kind: "refused", reason: decision.reason };
    }
  } else {
    let assignee: TaskUser | null = null;
    let assigneeName = "";
    let assigneeInvited = false;
    if (data.assigneeId) {
      const locked = await lockAssignee(tx, data.assigneeId);
      if (!locked) {
        return { kind: "assignee-not-found" };
      }
      assignee = locked.user;
      assigneeName = locked.fullName;
      assigneeInvited = locked.invitePending;
    }
    status = assignee ? "assigned" : "open";
    const decision = checkTransition({
      from: current.status,
      to: status,
      action: "updateTask",
      actor,
      currentAssigneeId: current.assigneeId,
      newAssignee: assignee,
    });
    if (!decision.allowed) {
      return assigneeProblemOf(decision.reason, assigneeName);
    }
    if (assigneeInvited) {
      return { kind: "assignee-invited", fullName: assigneeName };
    }
    assigneeId = assignee?.id ?? null;
  }

  const customerId = await resolveCustomerId(tx, actor.id, data.customer);

  const updated = await tx
    .update(tasks)
    .set({
      customerId,
      locationStreet: data.location.locationStreet,
      locationPostalCode: data.location.locationPostalCode,
      locationCity: data.location.locationCity,
      workType: data.workType,
      instructions: data.instructions,
      scheduledDate: data.scheduledDate,
      startTime: data.startTime,
      estimatedMinutes: data.estimatedMinutes,
      assigneeId,
      status,
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
  if (updated.length === 0) {
    // Not possible under the lock. Throwing rolls the transaction back, so a customer that was
    // saved for this task does not stay behind.
    throw new Error("updateTask: the locked task was not updated");
  }

  return { kind: "updated", id: updated[0].id, number: updated[0].number, status };
}
