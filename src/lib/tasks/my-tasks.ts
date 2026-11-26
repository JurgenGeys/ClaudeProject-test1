import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { customers, taskCompletions, tasks } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";
import { TIME_ZONE, brusselsDayKey } from "@/lib/time/format";
import type { MyTasksTab } from "@/lib/validation/my-tasks";

import { addDays } from "./my-tasks-groups";
import type { TaskStatus, WorkType } from "./types";

/** How far back the "Afgewerkt" tab looks (design T1): the last 30 days. */
export const DONE_DAYS = 30;

/** Longest piece of the instructions that is read: a card only shows the first line. */
const INSTRUCTIONS_PREVIEW_LENGTH = 300;

/** A card of the "Te doen" tab: a task that is Toegewezen or Opgepikt (design T1). */
export type MyOpenTask = {
  id: string;
  number: number;
  /** `2026-11-24` and `14:00:00` (Belgian wall clock, A22). */
  scheduledDate: string;
  startTime: string;
  estimatedMinutes: number | null;
  customerName: string;
  /** City of the place of work (the task's own location). */
  city: string;
  workType: WorkType;
  instructions: string;
  status: Extract<TaskStatus, "assigned" | "picked_up">;
  pickedUpAt: Date | null;
};

/** A line of the "Afgewerkt" tab: a task the technician finished (Afgewerkt or Gefactureerd). */
export type MyDoneTask = {
  id: string;
  number: number;
  scheduledDate: string;
  customerName: string;
  city: string;
  workType: WorkType;
  /** The hours the technician filled in himself, not the correction of the back office. */
  workedMinutes: number;
  completedAt: Date;
};

export type MyTasks = { tab: "todo"; tasks: MyOpenTask[] } | { tab: "done"; tasks: MyDoneTask[] };

/**
 * The tasks of one technician for T1. Every query has `assignee_id = technicianId`: nobody else's
 * task is read. Cancelled tasks are in no tab (design T1). Not assigned (Open) tasks have no
 * assignee, so they never match.
 * - "todo": Toegewezen and Opgepikt, oldest planned day and start time first (the grouping into
 *   Bezig, Te laat and days is `groupMyTasks`).
 * - "done": Afgewerkt and Gefactureerd (both are "Afgewerkt" for the technician) that were
 *   finished in the last 30 calendar days (Belgian days, today included); newest first.
 */
export async function queryMyTasks(
  db: Pick<Database, "select">,
  technicianId: string,
  tab: MyTasksTab,
  now: Date,
): Promise<MyTasks> {
  if (tab === "todo") {
    const rows = await db
      .select({
        id: tasks.id,
        number: tasks.number,
        scheduledDate: tasks.scheduledDate,
        startTime: tasks.startTime,
        estimatedMinutes: tasks.estimatedMinutes,
        customerName: customers.name,
        city: tasks.locationCity,
        workType: tasks.workType,
        instructions: sql<string>`left(${tasks.instructions}, ${INSTRUCTIONS_PREVIEW_LENGTH})`,
        status: tasks.status,
        pickedUpAt: tasks.pickedUpAt,
      })
      .from(tasks)
      .innerJoin(customers, eq(customers.id, tasks.customerId))
      .where(
        and(eq(tasks.assigneeId, technicianId), inArray(tasks.status, ["assigned", "picked_up"])),
      )
      .orderBy(asc(tasks.scheduledDate), asc(tasks.startTime), asc(tasks.number));
    return {
      tab,
      tasks: rows.flatMap((row) =>
        row.status === "assigned" || row.status === "picked_up"
          ? [{ ...row, status: row.status }]
          : [],
      ),
    };
  }

  // 30 calendar days including today: today and the 29 days before it.
  const firstDay = addDays(brusselsDayKey(now), -(DONE_DAYS - 1));
  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      scheduledDate: tasks.scheduledDate,
      customerName: customers.name,
      city: tasks.locationCity,
      workType: tasks.workType,
      workedMinutes: taskCompletions.workedMinutes,
      completedAt: taskCompletions.completedAt,
    })
    .from(tasks)
    .innerJoin(customers, eq(customers.id, tasks.customerId))
    .innerJoin(taskCompletions, eq(taskCompletions.taskId, tasks.id))
    .where(
      and(
        eq(tasks.assigneeId, technicianId),
        inArray(tasks.status, ["completed", "invoiced"]),
        sql`(${taskCompletions.completedAt} at time zone ${TIME_ZONE})::date >= ${firstDay}::date`,
      ),
    )
    .orderBy(desc(taskCompletions.completedAt), desc(tasks.number));
  return { tab, tasks: rows };
}

/**
 * The tasks of the signed-in technician for T1. Checks the role itself, before anything is
 * read (ADR-0002, rule 3), and uses the id of the session: nothing from the address or a
 * form decides whose tasks are read. Throws an `AuthError` for anyone else.
 */
export async function getMyTasks(tab: MyTasksTab, now: Date): Promise<MyTasks> {
  const user = await requireRole("technician");
  return queryMyTasks(getDb(), user.id, tab, now);
}
