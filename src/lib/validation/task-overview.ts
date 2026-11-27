import { z } from "zod";

import { taskStatuses, type TaskStatus } from "@/lib/tasks/types";

/**
 * The query parameters of the task overview (design B1), read from the URL:
 *
 *   /tasks?status=picked_up&technician=<uuid>&from=2026-11-01&to=2026-11-30
 *
 * A URL can be typed or edited by anyone, so every parameter is validated on its own and an
 * invalid one is ignored (as if it was not there) instead of failing the whole page.
 */

/** The status tabs: "active" is the default (Open, Toegewezen, Opgepikt and Afgewerkt). */
export const overviewTabs = ["active", ...taskStatuses, "all"] as const;
export type OverviewTab = (typeof overviewTabs)[number];

export const DEFAULT_OVERVIEW_TAB: OverviewTab = "active";

/** The statuses that "Actief" adds up: everything except Gefactureerd and Geannuleerd. */
export const activeStatuses = [
  "open",
  "assigned",
  "picked_up",
  "completed",
] as const satisfies readonly TaskStatus[];

// Years that make sense for a planning; also keeps odd years out of the database query.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export const dayParam = z.iso.date().refine((value) => {
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
});

const paramSchemas = {
  status: z.enum(overviewTabs),
  technician: z.uuid(),
  from: dayParam,
  to: dayParam,
  // A positive whole number, as plain digits (no "1e3", no "+2", no spaces).
  page: z
    .string()
    .regex(/^[1-9]\d{0,5}$/)
    .transform(Number),
} as const;

export type TaskOverviewFilters = {
  tab: OverviewTab;
  /** Id of the technician, or `null` for all technicians. */
  technician: string | null;
  /** First planned day (inclusive) as `2026-11-01`, or `null`. */
  from: string | null;
  /** Last planned day (inclusive), or `null`. */
  to: string | null;
  /** Requested page, from 1. The query clamps it to the last page. */
  page: number;
};

/** Tasks per page (decided by Jurgen, 25/11/2026). */
export const PAGE_SIZE = 50;

type RawParams = Record<string, string | string[] | undefined>;

/** The value of one parameter, or `undefined` when invalid, empty or given more than once. */
function readParam<K extends keyof typeof paramSchemas>(
  raw: RawParams,
  key: K,
): z.infer<(typeof paramSchemas)[K]> | undefined {
  const value = raw[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = paramSchemas[key].safeParse(value);
  // The assertion is safe: `key` selects the matching schema.
  return parsed.success ? (parsed.data as z.infer<(typeof paramSchemas)[K]>) : undefined;
}

/** Reads the filters from `searchParams`. Never throws; invalid values fall back to "no filter". */
export function parseTaskOverviewParams(raw: RawParams): TaskOverviewFilters {
  return {
    tab: readParam(raw, "status") ?? DEFAULT_OVERVIEW_TAB,
    technician: readParam(raw, "technician") ?? null,
    from: readParam(raw, "from") ?? null,
    to: readParam(raw, "to") ?? null,
    page: readParam(raw, "page") ?? 1,
  };
}

/** The period ends before it begins. Such a period is not applied; the form says so. */
export function isPeriodReversed(filters: Pick<TaskOverviewFilters, "from" | "to">): boolean {
  return filters.from !== null && filters.to !== null && filters.to < filters.from;
}

/** Whether a technician or period filter is set (the status tab is not a filter in this sense). */
export function hasExtraFilters(filters: TaskOverviewFilters): boolean {
  return filters.technician !== null || filters.from !== null || filters.to !== null;
}

/**
 * The URL of the overview for these filters. Default values are left out, so the default view
 * is plain `/tasks`. Used for the tab links, the page links and "Filters wissen".
 */
export function taskOverviewHref(filters: Partial<TaskOverviewFilters>): string {
  const query = new URLSearchParams();
  if (filters.tab && filters.tab !== DEFAULT_OVERVIEW_TAB) {
    query.set("status", filters.tab);
  }
  if (filters.technician) {
    query.set("technician", filters.technician);
  }
  if (filters.from) {
    query.set("from", filters.from);
  }
  if (filters.to) {
    query.set("to", filters.to);
  }
  if (filters.page && filters.page > 1) {
    query.set("page", String(filters.page));
  }
  const text = query.toString();
  return text ? `/tasks?${text}` : "/tasks";
}
