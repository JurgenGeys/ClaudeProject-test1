import { and, gte, lt, sql, type SQL } from "drizzle-orm";

import { taskCompletions } from "@/db/schema";

/**
 * "The day on which the technician completed the task", in Belgian time, as SQL. B1 (tabs
 * Afgewerkt and Gefactureerd) and the export (BT-16) both use these, so the link from the
 * export to the tab Afgewerkt shows exactly the tasks of the file.
 *
 * Days are inclusive. The condition is a range on the timestamp (local midnight of the first day
 * up to local midnight after the last day), so it follows the clock change (a day of 23 or 25
 * hours) and can use the index on `completed_at`.
 */

/** The Belgian day of `task_completions.completed_at` as text (`2026-11-03`), for the file. */
export const completedDay = sql<string>`to_char(${taskCompletions.completedAt} at time zone 'Europe/Brussels', 'YYYY-MM-DD')`;

/** Conditions for the given bounds (`null` = no bound on that side). Empty when both are `null`. */
export function completedBetween(from: string | null, to: string | null): SQL[] {
  const conditions: SQL[] = [];
  if (from) {
    conditions.push(
      gte(
        taskCompletions.completedAt,
        sql`(${from}::date)::timestamp at time zone 'Europe/Brussels'`,
      ),
    );
  }
  if (to) {
    conditions.push(
      lt(
        taskCompletions.completedAt,
        sql`((${to}::date + 1))::timestamp at time zone 'Europe/Brussels'`,
      ),
    );
  }
  return conditions;
}

/** The same as one condition (or `undefined` without bounds). */
export function completedBetweenCondition(from: string | null, to: string | null): SQL | undefined {
  return and(...completedBetween(from, to));
}
