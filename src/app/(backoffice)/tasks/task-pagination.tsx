import Link from "next/link";

import {
  PAGE_SIZE,
  taskOverviewHref,
  type TaskOverviewFilters,
} from "@/lib/validation/task-overview";

/**
 * "Vorige" and "Volgende" under the list (design B1): plain links that keep every filter and
 * change only `?page=`. Nothing is shown when there is one page.
 */
export function TaskPagination({
  filters,
  pageCount,
  total,
}: {
  filters: TaskOverviewFilters;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return null;
  }
  const page = filters.page;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const linkClass =
    "inline-flex h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent md:h-10";
  const disabledClass = `${linkClass} pointer-events-none opacity-50`;

  return (
    <nav
      aria-label="Paginering"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p>
        Taken {first} tot {last} van {total} (pagina {page} van {pageCount})
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={taskOverviewHref({ ...filters, page: page - 1 })}
            rel="prev"
            className={linkClass}
          >
            Vorige
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Vorige
          </span>
        )}
        {page < pageCount ? (
          <Link
            href={taskOverviewHref({ ...filters, page: page + 1 })}
            rel="next"
            className={linkClass}
          >
            Volgende
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Volgende
          </span>
        )}
      </div>
    </nav>
  );
}
