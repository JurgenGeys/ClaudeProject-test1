import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { customers, profiles, tasks } from "@/db/schema";
import type { CreateTaskData } from "@/lib/validation/create-task";

import { checkTransition, type TaskUser, type TransitionDenial } from "./transitions";
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
  /** No profile with this id, or it is not a technician. */
  | { kind: "assignee-not-found" }
  | { kind: "assignee-inactive"; fullName: string }
  /** Invited, no password chosen yet: he cannot sign in, so he would never see the task. */
  | { kind: "assignee-invited"; fullName: string }
  /** The transition rules refused for another reason (for example the actor). */
  | { kind: "refused"; reason: TransitionDenial };

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

  if (data.customer.kind === "existing") {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, data.customer.id))
      .limit(1);
    if (!customer) {
      return { kind: "customer-not-found" };
    }
  }

  let assignee: TaskUser | null = null;
  let assigneeName = "";
  let assigneeInvited = false;
  if (data.assigneeId) {
    const [profile] = await tx
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        isActive: profiles.isActive,
        invitePending: profiles.invitePending,
      })
      .from(profiles)
      .where(eq(profiles.id, data.assigneeId))
      .for("share");
    if (!profile) {
      return { kind: "assignee-not-found" };
    }
    assignee = { id: profile.id, role: profile.role, isActive: profile.isActive };
    assigneeName = profile.fullName;
    assigneeInvited = profile.invitePending;
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
    switch (decision.reason) {
      case "assignee_not_technician":
        return { kind: "assignee-not-found" };
      case "assignee_inactive":
        return { kind: "assignee-inactive", fullName: assigneeName };
      default:
        return { kind: "refused", reason: decision.reason };
    }
  }
  if (assigneeInvited) {
    return { kind: "assignee-invited", fullName: assigneeName };
  }

  let customerId: string;
  if (data.customer.kind === "new") {
    const [created] = await tx
      .insert(customers)
      .values({ ...data.customer.data, createdBy: actor.id })
      .returning({ id: customers.id });
    customerId = created.id;
  } else {
    customerId = data.customer.id;
  }

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
