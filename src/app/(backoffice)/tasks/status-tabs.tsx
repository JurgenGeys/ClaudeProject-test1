import Link from "next/link";

import { TASK_STATUS_LABELS } from "@/lib/tasks/labels";
import type { TabCounts } from "@/lib/tasks/overview-counts";
import {
  overviewTabs,
  taskOverviewHref,
  type OverviewTab,
  type TaskOverviewFilters,
} from "@/lib/validation/task-overview";
import { cn } from "@/lib/utils";

/** Labels of the tabs: the status labels, plus "Actief" and "Alle" (design B1). */
export const TAB_LABELS: Record<OverviewTab, string> = {
  active: "Actief",
  ...TASK_STATUS_LABELS,
  all: "Alle",
};

/**
 * The status tabs with their counts (design B1). They are links that change the URL, so the
 * list is always the one of the address (and Back works); the current tab has `aria-current`.
 * That is the right pattern for navigation: ARIA `role="tab"` would promise arrow-key handling
 * and a panel that this page does not have. The links are reached with Tab, like any link.
 * The technician and period filter stay when a tab is chosen.
 */
export function StatusTabs({
  filters,
  counts,
}: {
  filters: TaskOverviewFilters;
  counts: TabCounts;
}) {
  return (
    <nav
      aria-label="Status"
      className="mt-5 flex w-fit max-w-full flex-wrap gap-1 rounded-md bg-muted p-1 text-sm font-medium"
    >
      {overviewTabs.map((tab) => {
        const current = tab === filters.tab;
        return (
          <Link
            key={tab}
            href={taskOverviewHref({ ...filters, tab })}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded px-3 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-9",
              current
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            {TAB_LABELS[tab]}
            <span className="text-muted-foreground tabular-nums">
              {counts[tab]}
              <span className="sr-only"> {counts[tab] === 1 ? "taak" : "taken"}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
