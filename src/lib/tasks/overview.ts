import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, type Database } from "@/db/client";
import { customers, profiles, taskCompletions, tasks } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";
import {
  activeStatuses,
  isPeriodReversed,
  PAGE_SIZE,
  parseTaskOverviewParams,
  type TaskOverviewFilters,
} from "@/lib/validation/task-overview";

import { countsPerTab, type TabCounts } from "./overview-counts";
import { taskStatuses, type TaskStatus, type WorkType } from "./types";
import { taskVersion } from "./version";

/** One line of the task overview (design B1). */
export type TaskOverviewRow = {
  id: string;
  number: number;
  /**
   * `updated_at` as a version (`2026-11-25T18:44:00.123456Z`). The selection for "Markeer als
   * gefactureerd" sends it back, so a task that changed meanwhile is not marked blindly.
   */
  version: string;
  /** Planned day as `2026-11-24` and start time as `14:00:00` (Belgian wall clock, A22). */
  scheduledDate: string;
  startTime: string;
  customerName: string;
  /** City of the place of work (the task's own location, which may differ from the customer's). */
  city: string;
  workType: WorkType;
  instructions: string;
  status: TaskStatus;
  /** `null` for a task that is not assigned (Open, or a cancelled one that never was). */
  technicianName: string | null;
  /** Since when the task is picked up; `null` before Opgepikt. */
  pickedUpAt: Date | null;
  /** The hours that count (the correction if there is one); `null` before Afgewerkt. */
  minutes: number | null;
  corrected: boolean;
};

/** A technician in the filter list. Switched-off technicians stay in it: their tasks remain. */
export type FilterTechnician = { id: string; fullName: string; isActive: boolean };

export type TaskOverview = {
  /** The filters that were applied: invalid or unknown values are already removed. */
  filters: TaskOverviewFilters;
  technicians: FilterTechnician[];
  counts: TabCounts;
  rows: TaskOverviewRow[];
  /** The page that is shown (from 1) and the number of pages of the current tab. */
  page: number;
  pageCount: number;
  /** The period ends before it begins: it was not applied, and the form shows a message. */
  periodReversed: boolean;
  /** Whether there is any task at all, whatever the filters. Tells "no tasks yet" from "no match". */
  hasAnyTask: boolean;
};

/** Tabs that show the newest first (design B1, "Sortering"); the others show the oldest first. */
const NEWEST_FIRST: readonly string[] = ["completed", "invoiced", "cancelled"];

/** The technicians for the filter: active and switched off, not the invited ones (they have no tasks). */
export async function queryFilterTechnicians(
  db: Pick<Database, "select">,
): Promise<FilterTechnician[]> {
  const rows = await db
    .select({ id: profiles.id, fullName: profiles.fullName, isActive: profiles.isActive })
    .from(profiles)
    .where(and(eq(profiles.role, "technician"), eq(profiles.invitePending, false)))
    .orderBy(asc(profiles.id));
  return rows.sort((a, b) =>
    a.fullName.localeCompare(b.fullName, "nl-BE", { sensitivity: "base" }),
  );
}

/** Longest piece of the instructions that is read: lists only show the first line. */
const INSTRUCTIONS_PREVIEW_LENGTH = 300;

/**
 * The conditions of the technician and period filters, which the counts and the list share.
 * An impossible period (end before start) is not applied.
 */
function extraConditions(filters: TaskOverviewFilters): SQL[] {
  const conditions: SQL[] = [];
  const period = !isPeriodReversed(filters);
  if (filters.technician) {
    conditions.push(eq(tasks.assigneeId, filters.technician));
  }
  if (period && filters.from) {
    conditions.push(gte(tasks.scheduledDate, filters.from));
  }
  if (period && filters.to) {
    conditions.push(lte(tasks.scheduledDate, filters.to));
  }
  return conditions;
}

function tabCondition(tab: TaskOverviewFilters["tab"]): SQL | undefined {
  if (tab === "all") {
    return undefined;
  }
  if (tab === "active") {
    return inArray(tasks.status, [...activeStatuses]);
  }
  return eq(tasks.status, tab);
}

/**
 * The data of B1 for already validated filters. The counts follow the technician and period
 * filter (so a tab's number is what the tab shows) but not the tab itself. A technician that is
 * not in the database is dropped from the filters, so the page never says "all technicians"
 * while it shows the tasks of nobody.
 */
export async function queryTaskOverview(
  db: Pick<Database, "select">,
  requested: TaskOverviewFilters,
): Promise<TaskOverview> {
  const technicians = await queryFilterTechnicians(db);
  const filters: TaskOverviewFilters = {
    ...requested,
    page: 1, // replaced below, when the number of pages is known
    technician: technicians.some((t) => t.id === requested.technician)
      ? requested.technician
      : null,
  };
  const extra = extraConditions(filters);

  const assignee = alias(profiles, "assignee");
  const newestFirst = NEWEST_FIRST.includes(filters.tab);
  const direction = newestFirst ? desc : asc;

  const [perStatus, anyTask] = await Promise.all([
    db
      .select({ status: tasks.status, total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(...extra))
      .groupBy(tasks.status),
    db.select({ id: tasks.id }).from(tasks).limit(1),
  ]);

  const perStatusMap: Partial<Record<TaskStatus, number>> = {};
  for (const { status, total } of perStatus) {
    if (taskStatuses.includes(status)) {
      perStatusMap[status] = total;
    }
  }
  const counts = countsPerTab(perStatusMap);

  // A page that is too high (a bookmark, or tasks that were removed from the tab) shows the last one.
  const pageCount = Math.max(1, Math.ceil(counts[filters.tab] / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested.page), pageCount);

  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      version: taskVersion,
      scheduledDate: tasks.scheduledDate,
      startTime: tasks.startTime,
      customerName: customers.name,
      city: tasks.locationCity,
      workType: tasks.workType,
      // Only the start: a list shows the first line, and instructions can be long.
      instructions: sql<string>`left(${tasks.instructions}, ${INSTRUCTIONS_PREVIEW_LENGTH})`,
      status: tasks.status,
      technicianName: assignee.fullName,
      pickedUpAt: tasks.pickedUpAt,
      minutes: sql<
        number | null
      >`coalesce(${taskCompletions.correctedMinutes}, ${taskCompletions.workedMinutes})`,
      corrected: sql<boolean>`${taskCompletions.correctedMinutes} is not null`,
    })
    .from(tasks)
    .innerJoin(customers, eq(customers.id, tasks.customerId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(taskCompletions, eq(taskCompletions.taskId, tasks.id))
    .where(and(tabCondition(filters.tab), ...extra))
    .orderBy(direction(tasks.scheduledDate), direction(tasks.startTime), direction(tasks.number))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    filters: { ...filters, page },
    technicians,
    counts,
    rows: rows.map((row) => ({ ...row, corrected: row.corrected === true })),
    page,
    pageCount,
    periodReversed: isPeriodReversed(filters),
    hasAnyTask: anyTask.length > 0,
  };
}

/**
 * The overview for B1. Checks the role itself, before anything is read (ADR-0002, rule 3):
 * it holds customer names and instructions, so it is for backoffice only. Throws an
 * `AuthError` for anyone else. `searchParams` is parsed here; invalid values are ignored.
 */
export async function getTaskOverview(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<TaskOverview> {
  await requireRole("backoffice");
  return queryTaskOverview(getDb(), parseTaskOverviewParams(searchParams));
}
