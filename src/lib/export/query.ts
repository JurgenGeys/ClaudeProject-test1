import "server-only";

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db/client";
import { customers, profiles, taskCompletions, tasks } from "@/db/schema";
import type { ExportParams } from "@/lib/validation/export";

import type { ExportRow } from "./csv";

/**
 * The tasks of the export (design B4). Only what the file holds: no ids, no e-mail addresses,
 * no phone numbers.
 *
 * - **Period**: the day on which the technician completed the task (`task_completions.completed_at`),
 *   in Belgian time, both days inclusive. The test is a range on the timestamp (local midnight of
 *   the first day up to local midnight after the last day), so it follows the clock change and can use
 *   the index.
 * - **Which tasks**: Afgewerkt, or with scope "all" also Gefactureerd. Cancelled tasks never have a
 *   completion and are never selected.
 * - **Hours**: the correction if there is one, otherwise the technician's hours. Not rounded
 *   (the client has not answered question #53 yet): the hours are stored per quarter.
 * - **Order**: planned day, start time, task number.
 */
export async function queryExportRows(
  db: Pick<Database, "select">,
  { from, to, scope }: ExportParams,
): Promise<ExportRow[]> {
  const assignee = alias(profiles, "assignee");
  const statuses =
    scope === "all" ? (["completed", "invoiced"] as const) : (["completed"] as const);

  const rows = await db
    .select({
      number: tasks.number,
      scheduledDate: tasks.scheduledDate,
      customerName: customers.name,
      street: tasks.locationStreet,
      postalCode: tasks.locationPostalCode,
      city: tasks.locationCity,
      technicianName: assignee.fullName,
      workType: tasks.workType,
      instructions: tasks.instructions,
      minutes: sql<number>`coalesce(${taskCompletions.correctedMinutes}, ${taskCompletions.workedMinutes})`,
      notes: taskCompletions.notes,
      status: tasks.status,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .innerJoin(customers, eq(customers.id, tasks.customerId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(
      and(
        inArray(tasks.status, [...statuses]),
        gte(
          taskCompletions.completedAt,
          sql`(${from}::date)::timestamp at time zone 'Europe/Brussels'`,
        ),
        lt(
          taskCompletions.completedAt,
          sql`((${to}::date + 1))::timestamp at time zone 'Europe/Brussels'`,
        ),
      ),
    )
    .orderBy(asc(tasks.scheduledDate), asc(tasks.startTime), asc(tasks.number));

  return rows.map((row) => ({
    ...row,
    // The status filter above only lets these two through.
    status: row.status === "invoiced" ? "invoiced" : "completed",
  }));
}
