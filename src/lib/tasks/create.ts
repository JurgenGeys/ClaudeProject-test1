import "server-only";

import type { Database } from "@/db/client";
import { tasks } from "@/db/schema";
import type { CreateTaskData } from "@/lib/validation/create-task";

import { assigneeProblemOf, lockAssignee, type AssigneeProblem } from "./assignee";
import { customerExists, resolveCustomerId } from "./customer";
import { checkTransition, type TaskUser } from "./transitions";
import type { TaskStatus } from "./types";

/** What `createTaskInTransaction` did, or why it refused. */
export type CreateTaskOutcome =
  | {
      kind: "created";
      id: string;
      number: number;
      status: Extract<TaskStatus, "open" | "assigned">;
    }
  /** The chosen existing customer is gone (nothing is deleted, so this is a forged id). */
  | { kind: "customer-not-found" }
  | AssigneeProblem;

/** The part of a Drizzle transaction that is needed here. */
export type CreateTaskTransaction = Pick<Database, "select" | "insert">;

/**
 * Saves a new task (design B2, chapter 4 and 6), and a new customer with it when the form has one.
 *
 * Must run inside a transaction, which the caller commits: everything or nothing is saved.
 * Order of the steps, so a refusal never leaves anything behind:
 * 1. an existing customer must exist;
 * 2. the technician's profile is read with `FOR SHARE` and checked (technician, active, not only
 *    invited) by `checkTransition` (`createTask`). The lock is the rule of BT-07: switching a
 *    technician off takes `FOR UPDATE` on this row, so either the switch-off commits first and
 *    this transaction sees `is_active = false`, or this transaction commits first and the
 *    switch-off counts the new task and is refused. See `deactivateTechnicianProfile`;
 * 3. only then the new customer (address = location of the task) and the task are inserted:
 *    Open without a technician, Toegewezen with one. The task number comes from the database
 *    (identity column), `created_by` and `updated_by` are the actor.
 */
export async function createTaskInTransaction(
  tx: CreateTaskTransaction,
  input: { actor: TaskUser; data: CreateTaskData },
): Promise<CreateTaskOutcome> {
  const { actor, data } = input;

  if (data.customer.kind === "existing" && !(await customerExists(tx, data.customer.id))) {
    return { kind: "customer-not-found" };
  }

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

  const status = assignee ? "assigned" : "open";
  const decision = checkTransition({
    from: "new",
    to: status,
    action: "createTask",
    actor,
    newAssignee: assignee,
  });
  if (!decision.allowed) {
    return assigneeProblemOf(decision.reason, assigneeName);
  }
  if (assigneeInvited) {
    return { kind: "assignee-invited", fullName: assigneeName };
  }

  const customerId = await resolveCustomerId(tx, actor.id, data.customer);

  const [task] = await tx
    .insert(tasks)
    .values({
      customerId,
      locationStreet: data.location.locationStreet,
      locationPostalCode: data.location.locationPostalCode,
      locationCity: data.location.locationCity,
      workType: data.workType,
      instructions: data.instructions,
      scheduledDate: data.scheduledDate,
      startTime: data.startTime,
      estimatedMinutes: data.estimatedMinutes,
      assigneeId: assignee?.id ?? null,
      status,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning({ id: tasks.id, number: tasks.number });

  return { kind: "created", id: task.id, number: task.number, status };
}
