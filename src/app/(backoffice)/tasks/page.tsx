import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { getTaskOverview } from "@/lib/tasks/overview";
import { hasExtraFilters, taskOverviewHref } from "@/lib/validation/task-overview";

import { StatusTabs } from "./status-tabs";
import { TaskFilters } from "./task-filters";
import { TaskList } from "./task-list";
import { TaskPagination } from "./task-pagination";

export const metadata: Metadata = { title: "Taken" };

/**
 * The task overview (B1): status tabs with counts, filters on technician and period (all in the
 * URL), and the tasks as a table or, on a phone, as cards. "Exporteren" and the selection for
 * "Markeer als gefactureerd" follow in BT-16 and BT-17.
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  // The lookup is cached per request, so this costs nothing extra.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const params = await searchParams;
  const { filters, technicians, counts, rows, hasAnyTask, pageCount, periodReversed } =
    await getTaskOverview(params);
  // Cancelled has its own message when nothing else narrows the list down.
  const noCancelledTasks = filters.tab === "cancelled" && !hasExtraFilters(filters);

  const newTaskButton = (
    <Button asChild className="h-11 px-4 md:h-10">
      <Link href="/tasks/new">
        <Plus aria-hidden="true" />
        Nieuwe taak
      </Link>
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Taken</h1>
        {/* With no tasks at all the button is in the empty state, so there is one link, not two. */}
        {hasAnyTask ? newTaskButton : null}
      </div>

      {!hasAnyTask ? (
        <div className="mt-8 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-lg font-medium">Er zijn nog geen taken.</p>
          <p className="mt-1 text-muted-foreground">
            Maak je eerste taak aan en wijs ze toe aan een technieker.
          </p>
          <div className="mt-4 flex justify-center">{newTaskButton}</div>
        </div>
      ) : (
        <>
          <StatusTabs filters={filters} counts={counts} />
          <TaskFilters
            filters={filters}
            technicians={technicians}
            periodReversed={periodReversed}
          />
          {rows.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
              <p className="font-medium">
                {noCancelledTasks
                  ? "Er zijn geen geannuleerde taken."
                  : "Geen taken gevonden voor deze filter."}
              </p>
              {/* Clears the technician and period; without those, it clears the tab too. */}
              {noCancelledTasks ? null : (
                <Button asChild variant="outline" className="mt-3 h-11 px-4 md:h-10">
                  <Link
                    href={taskOverviewHref(hasExtraFilters(filters) ? { tab: filters.tab } : {})}
                  >
                    Filters wissen
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <>
              <TaskList rows={rows} />
              <TaskPagination filters={filters} pageCount={pageCount} total={counts[filters.tab]} />
            </>
          )}
        </>
      )}
    </>
  );
}
