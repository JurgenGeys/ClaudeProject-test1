import { activeStatuses, overviewTabs, type OverviewTab } from "@/lib/validation/task-overview";

import { taskStatuses, type TaskStatus } from "./types";

export type TabCounts = Record<OverviewTab, number>;

/**
 * The number on each status tab, from the number of tasks per status. "Actief" adds up Open,
 * Toegewezen, Opgepikt and Afgewerkt (Gefactureerd and Geannuleerd are not in it); "Alle" adds
 * up everything, including Geannuleerd.
 */
export function countsPerTab(perStatus: Partial<Record<TaskStatus, number>>): TabCounts {
  const count = (status: TaskStatus) => perStatus[status] ?? 0;
  const counts = Object.fromEntries(overviewTabs.map((tab) => [tab, 0])) as TabCounts;
  for (const status of taskStatuses) {
    counts[status] = count(status);
  }
  counts.active = activeStatuses.reduce((sum, status) => sum + count(status), 0);
  counts.all = taskStatuses.reduce((sum, status) => sum + count(status), 0);
  return counts;
}
