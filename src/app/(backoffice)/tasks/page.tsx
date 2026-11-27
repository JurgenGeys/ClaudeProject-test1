import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { INVOICE_MESSAGES } from "@/lib/tasks/invoice-messages";
import { getTaskOverview } from "@/lib/tasks/overview";
import { hasExtraFilters, taskOverviewHref } from "@/lib/validation/task-overview";

import { StatusTabs } from "./status-tabs";
import { TaskFilters } from "./task-filters";
import { InvoicingNoticeProvider } from "./invoicing-notice";
import { SelectableTaskList } from "./selectable-task-list";
import { TaskList } from "./task-list";
import { TaskPagination } from "./task-pagination";

export const metadata: Metadata = { title: "Taken" };

/**
 * The area under the heading. On the tab Afgewerkt it sits in the provider of the message "N taken
 * gemarkeerd als gefactureerd" (client state, see `InvoicingNoticeProvider`); the other tabs have
 * nothing to mark and render the content as it is.
 */
function ListArea({ selectable, children }: { selectable: boolean; children: ReactNode }) {
  return selectable ? (
    <InvoicingNoticeProvider>{children}</InvoicingNoticeProvider>
  ) : (
    <>{children}</>
  );
}

/**
 * The task overview (B1): status tabs with counts, filters on technician and period (all in the
 * URL), and the tasks as a table or, on a phone, as cards. On the tab Afgewerkt the rows have
 * checkboxes for "Markeer als gefactureerd" (BT-17). "Exporteren" opens B4 (BT-16).
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

  const pagination = (
    <TaskPagination filters={filters} pageCount={pageCount} total={counts[filters.tab]} />
  );

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
        {hasAnyTask ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-11 px-4 md:h-10">
              <Link href="/tasks/export">
                <Download aria-hidden="true" />
                Exporteren
              </Link>
            </Button>
            {newTaskButton}
          </div>
        ) : null}
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
        <ListArea key={taskOverviewHref(filters)} selectable={filters.tab === "completed"}>
          <StatusTabs filters={filters} counts={counts} />
          {filters.tab === "completed" ? (
            <p className="mt-3 text-sm text-muted-foreground">{INVOICE_MESSAGES.completedIntro}</p>
          ) : null}
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
              {filters.tab === "completed" ? (
                <SelectableTaskList rows={rows}>{pagination}</SelectableTaskList>
              ) : (
                <>
                  <TaskList rows={rows} />
                  {pagination}
                </>
              )}
            </>
          )}
        </ListArea>
      )}
    </>
  );
}
