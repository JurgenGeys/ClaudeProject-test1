import Link from "next/link";

import { CUSTOMER_PAGE_SIZE } from "@/lib/customers/limits";
import { customerListHref, type CustomerListParams } from "@/lib/validation/customer-list";

/**
 * "Vorige" and "Volgende" under the customer list: plain links that keep the search text and
 * change only `?page=`. Nothing is shown when there is one page.
 */
export function CustomerPagination({
  params,
  pageCount,
  total,
}: {
  params: CustomerListParams;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return null;
  }
  const { page } = params;
  const first = (page - 1) * CUSTOMER_PAGE_SIZE + 1;
  const last = Math.min(page * CUSTOMER_PAGE_SIZE, total);
  const linkClass =
    "inline-flex h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent md:h-10";

  return (
    <nav
      aria-label="Paginering"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p>
        Klanten {first} tot {last} van {total} (pagina {page} van {pageCount})
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={customerListHref({ ...params, page: page - 1 })}
            rel="prev"
            className={linkClass}
          >
            Vorige
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link
            href={customerListHref({ ...params, page: page + 1 })}
            rel="next"
            className={linkClass}
          >
            Volgende
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
