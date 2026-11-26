import "server-only";

import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, type Database } from "@/db/client";
import { customers, profiles, taskCompletions, tasks } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";

import type { TaskStatus, WorkType } from "./types";
import { taskVersion } from "./version";

/** The hours report of a task from Afgewerkt on (design B3, block "Afmelding"). */
export type TaskDetailCompletion = {
  workedMinutes: number;
  notes: string | null;
  completedAt: Date;
  completedByName: string;
  correctedMinutes: number | null;
  correctionReason: string | null;
  correctedAt: Date | null;
  correctedByName: string | null;
};

/** Everything B3 shows, and what the edit form starts from. */
export type TaskDetail = {
  id: string;
  number: number;
  status: TaskStatus;
  /**
   * `updated_at` as `2026-11-25T18:44:00.123456Z` (UTC, microseconds). The edit form sends it
   * back; the database compares it to detect that someone else changed the task meanwhile.
   */
  version: string;
  workType: WorkType;
  instructions: string;
  /** `2026-11-24` and `14:00:00` (Belgian wall clock, assumption A22). */
  scheduledDate: string;
  startTime: string;
  estimatedMinutes: number | null;
  locationStreet: string;
  locationPostalCode: string;
  locationCity: string;
  customer: {
    id: string;
    name: string;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    phone: string | null;
    notes: string | null;
  };
  assignee: { id: string; fullName: string } | null;
  createdAt: Date;
  createdByName: string;
  pickedUpAt: Date | null;
  invoicedAt: Date | null;
  invoicedByName: string | null;
  cancelledAt: Date | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  completion: TaskDetailCompletion | null;
};

/**
 * The query behind `getTaskDetail` and `getMyTaskDetail`; exported with the database as a
 * parameter for the database test. With `assigneeId` only a task of that assignee is found
 * (T2: a technician sees his own tasks), so a task of somebody else is `null`, exactly like a
 * task that does not exist.
 */
export async function queryTaskDetail(
  db: Pick<Database, "select">,
  number: number,
  options: { assigneeId?: string } = {},
): Promise<TaskDetail | null> {
  const assignee = alias(profiles, "assignee");
  const creator = alias(profiles, "creator");
  const invoicer = alias(profiles, "invoicer");
  const canceller = alias(profiles, "canceller");
  const completer = alias(profiles, "completer");
  const corrector = alias(profiles, "corrector");

  const [row] = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      status: tasks.status,
      version: taskVersion,
      workType: tasks.workType,
      instructions: tasks.instructions,
      scheduledDate: tasks.scheduledDate,
      startTime: tasks.startTime,
      estimatedMinutes: tasks.estimatedMinutes,
      locationStreet: tasks.locationStreet,
      locationPostalCode: tasks.locationPostalCode,
      locationCity: tasks.locationCity,
      customerId: customers.id,
      customerName: customers.name,
      customerStreet: customers.street,
      customerPostalCode: customers.postalCode,
      customerCity: customers.city,
      customerPhone: customers.phone,
      customerNotes: customers.notes,
      assigneeId: assignee.id,
      assigneeName: assignee.fullName,
      createdAt: tasks.createdAt,
      createdByName: creator.fullName,
      pickedUpAt: tasks.pickedUpAt,
      invoicedAt: tasks.invoicedAt,
      invoicedByName: invoicer.fullName,
      cancelledAt: tasks.cancelledAt,
      cancelledByName: canceller.fullName,
      cancellationReason: tasks.cancellationReason,
      completionId: taskCompletions.id,
      workedMinutes: taskCompletions.workedMinutes,
      notes: taskCompletions.notes,
      completedAt: taskCompletions.completedAt,
      completedByName: completer.fullName,
      correctedMinutes: taskCompletions.correctedMinutes,
      correctionReason: taskCompletions.correctionReason,
      correctedAt: taskCompletions.correctedAt,
      correctedByName: corrector.fullName,
    })
    .from(tasks)
    .innerJoin(customers, eq(customers.id, tasks.customerId))
    .innerJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(invoicer, eq(invoicer.id, tasks.invoicedBy))
    .leftJoin(canceller, eq(canceller.id, tasks.cancelledBy))
    .leftJoin(taskCompletions, eq(taskCompletions.taskId, tasks.id))
    .leftJoin(completer, eq(completer.id, taskCompletions.completedBy))
    .leftJoin(corrector, eq(corrector.id, taskCompletions.correctedBy))
    .where(
      and(
        eq(tasks.number, number),
        options.assigneeId !== undefined ? eq(tasks.assigneeId, options.assigneeId) : undefined,
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    number: row.number,
    status: row.status,
    version: row.version,
    workType: row.workType,
    instructions: row.instructions,
    scheduledDate: row.scheduledDate,
    startTime: row.startTime,
    estimatedMinutes: row.estimatedMinutes,
    locationStreet: row.locationStreet,
    locationPostalCode: row.locationPostalCode,
    locationCity: row.locationCity,
    customer: {
      id: row.customerId,
      name: row.customerName,
      street: row.customerStreet,
      postalCode: row.customerPostalCode,
      city: row.customerCity,
      phone: row.customerPhone,
      notes: row.customerNotes,
    },
    assignee:
      row.assigneeId && row.assigneeName
        ? { id: row.assigneeId, fullName: row.assigneeName }
        : null,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
    pickedUpAt: row.pickedUpAt,
    invoicedAt: row.invoicedAt,
    invoicedByName: row.invoicedByName,
    cancelledAt: row.cancelledAt,
    cancelledByName: row.cancelledByName,
    cancellationReason: row.cancellationReason,
    completion:
      row.completionId && row.workedMinutes !== null && row.completedAt && row.completedByName
        ? {
            workedMinutes: row.workedMinutes,
            notes: row.notes,
            completedAt: row.completedAt,
            completedByName: row.completedByName,
            correctedMinutes: row.correctedMinutes,
            correctionReason: row.correctionReason,
            correctedAt: row.correctedAt,
            correctedByName: row.correctedByName,
          }
        : null,
  };
}

/**
 * The task for B3 and the edit form, by its number. Checks the role itself, before anything
 * is read (ADR-0002, rule 3): it holds customer data, so it is for backoffice only. Throws an
 * `AuthError` for anyone else. `null` when there is no such task.
 */
export async function getTaskDetail(number: number): Promise<TaskDetail | null> {
  await requireRole("backoffice");
  return queryTaskDetail(getDb(), number);
}

/**
 * The task for T2 (technician), by its number. Checks the role itself, before anything is read
 * (ADR-0002, rule 3), and only finds a task whose `assignee_id` is the signed-in user (the id
 * of the session, never one from the address). `null` for a task that does not exist, one that
 * is not assigned, and one of somebody else: the page cannot tell them apart.
 */
export async function getMyTaskDetail(number: number): Promise<TaskDetail | null> {
  const user = await requireRole("technician");
  return queryTaskDetail(getDb(), number, { assigneeId: user.id });
}
