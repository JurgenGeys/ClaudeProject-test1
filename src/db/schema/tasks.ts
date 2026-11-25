import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { CANCELLATION_REASON_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../lib/tasks/limits";
import { taskStatuses, workTypes } from "../../lib/tasks/types";
import { customers } from "./customers";
import { profiles } from "./profiles";

// The enums are built from the lists in `src/lib/tasks/types.ts`, the single place where the
// allowed values live, so the code and the database cannot drift apart.
export const taskStatusEnum = pgEnum("task_status", taskStatuses);
export const workTypeEnum = pgEnum("work_type", workTypes);

/**
 * A task (design chapter 5). The rules of chapter 4 that the database can check on its own
 * (which fields belong to which status) are check constraints; who may do which transition is
 * decided in `src/lib/tasks/transitions.ts` and in the Server Actions.
 *
 * Nothing is deleted: every foreign key is `ON DELETE RESTRICT`. A cancelled task keeps its
 * row and its last assignee.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Reference for phone and invoice (`#1042`). The database hands it out, starting at 1001;
    // gaps are fine. Never typed in by a user, hence ALWAYS.
    number: integer("number").notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    // Copy of the customer address when the task was made, adjustable per task.
    locationStreet: text("location_street").notNull(),
    locationPostalCode: text("location_postal_code").notNull(),
    locationCity: text("location_city").notNull(),
    workType: workTypeEnum("work_type").notNull(),
    instructions: text("instructions").notNull(),
    // Local Belgian planning without time zone (assumption A22).
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
    startTime: time("start_time").notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    assigneeId: uuid("assignee_id").references(() => profiles.id, { onDelete: "restrict" }),
    status: taskStatusEnum("status").notNull().default("open"),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    invoicedBy: uuid("invoiced_by").references(() => profiles.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => profiles.id, { onDelete: "restrict" }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    // Not maintained by the database: the Server Action sets both on every update.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
  },
  (table) => [
    unique("tasks_number_unique").on(table.number),

    // B1 and T1: "my tasks" per technician, per status, ordered by date.
    index("tasks_assignee_status_date_idx").on(table.assigneeId, table.status, table.scheduledDate),
    // B1: status tabs with counts and the list per status, ordered by date.
    index("tasks_status_date_idx").on(table.status, table.scheduledDate),
    // B1: filter on period across all statuses.
    index("tasks_scheduled_date_idx").on(table.scheduledDate),
    // B6: the tasks of a customer.
    index("tasks_customer_idx").on(table.customerId),

    // Open has no assignee; every other active status has one. A cancelled task may keep its
    // last assignee for the history, or have none.
    check(
      "tasks_assignee_matches_status",
      sql`(${table.status} = 'open' and ${table.assigneeId} is null)
        or (${table.status} in ('assigned', 'picked_up', 'completed', 'invoiced') and ${table.assigneeId} is not null)
        or ${table.status} = 'cancelled'`,
    ),
    // Picked up at is filled from Opgepikt on and wiped by Terugzetten.
    check(
      "tasks_picked_up_at_matches_status",
      sql`(${table.status} in ('picked_up', 'completed', 'invoiced')) = (${table.pickedUpAt} is not null)`,
    ),
    check(
      "tasks_invoiced_matches_status",
      sql`(${table.status} = 'invoiced') = (${table.invoicedAt} is not null)
        and (${table.status} = 'invoiced') = (${table.invoicedBy} is not null)`,
    ),
    check(
      "tasks_cancelled_matches_status",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelledBy} is not null)`,
    ),
    check(
      "tasks_cancellation_reason_valid",
      sql`${table.cancellationReason} is null
        or (${table.status} = 'cancelled' and char_length(${table.cancellationReason}) <= ${sql.raw(String(CANCELLATION_REASON_MAX_LENGTH))})`,
    ),
    check(
      "tasks_estimated_minutes_valid",
      sql`${table.estimatedMinutes} is null or (${table.estimatedMinutes} > 0 and ${table.estimatedMinutes} % 15 = 0)`,
    ),
  ],
  // Row Level Security without policies: the public Supabase API can do nothing with this table.
).enableRLS();

/**
 * The completion of a task by the technician (one per task), with the optional correction by
 * the back office next to it. The original hours are never overwritten (assumption A19); the
 * hours that count are `coalesce(corrected_minutes, worked_minutes)`.
 *
 * A row only exists for a task with status `completed` or `invoiced`. That involves two tables,
 * so the Server Action checks it in the same transaction (design chapter 5).
 */
export const taskCompletions = pgTable(
  "task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    // Minutes as reported by the technician. The maximum (16u00) is in the Zod schema.
    workedMinutes: integer("worked_minutes").notNull(),
    notes: text("notes"),
    completedBy: uuid("completed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    correctedMinutes: integer("corrected_minutes"),
    correctionReason: text("correction_reason"),
    correctedBy: uuid("corrected_by").references(() => profiles.id, { onDelete: "restrict" }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
  },
  (table) => [
    // One completion per task (also the index to find it from the task).
    unique("task_completions_task_id_unique").on(table.taskId),
    // B4: the export selects on the day the task was completed.
    index("task_completions_completed_at_idx").on(table.completedAt),

    check(
      "task_completions_worked_minutes_valid",
      sql`${table.workedMinutes} > 0 and ${table.workedMinutes} % 15 = 0`,
    ),
    check(
      "task_completions_corrected_minutes_valid",
      sql`${table.correctedMinutes} is null or (${table.correctedMinutes} > 0 and ${table.correctedMinutes} % 15 = 0)`,
    ),
    // A correction is all or nothing: hours, reason, who and when come together.
    check(
      "task_completions_correction_complete",
      sql`num_nonnulls(${table.correctedMinutes}, ${table.correctionReason}, ${table.correctedBy}, ${table.correctedAt}) in (0, 4)`,
    ),
    // The reason is required: an empty or blank reason does not count.
    check(
      "task_completions_correction_reason_not_blank",
      sql`${table.correctionReason} is null or char_length(btrim(${table.correctionReason})) > 0`,
    ),
    check(
      "task_completions_notes_length",
      sql`${table.notes} is null or char_length(${table.notes}) <= ${sql.raw(String(NOTES_MAX_LENGTH))}`,
    ),
  ],
  // Row Level Security without policies: the public Supabase API can do nothing with this table.
).enableRLS();

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskCompletion = typeof taskCompletions.$inferSelect;
export type NewTaskCompletion = typeof taskCompletions.$inferInsert;
