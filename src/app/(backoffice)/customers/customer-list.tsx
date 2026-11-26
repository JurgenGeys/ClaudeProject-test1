import Link from "next/link";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerListRow } from "@/lib/customers/list";
import { formatDate } from "@/lib/time/format";

/** `Vrijheid 18, 2370 Arendonk` as far as the address is known; `null` when nothing is. */
export function formatAddress(customer: {
  street: string | null;
  postalCode: string | null;
  city: string | null;
}): string | null {
  const place = [customer.postalCode, customer.city].filter(Boolean).join(" ");
  return [customer.street, place].filter(Boolean).join(", ") || null;
}

export function customerHref(row: Pick<CustomerListRow, "id">): string {
  return `/customers/${row.id}`;
}

function Unknown() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        –
      </span>
      <span className="sr-only">onbekend</span>
    </>
  );
}

/**
 * The customers as a table on a laptop (design B5) and as cards on a phone. Both are rendered
 * and CSS shows one of them, like the task list: real table semantics on the laptop, a simple
 * list on the phone.
 */
export function CustomerList({ rows }: { rows: CustomerListRow[] }) {
  return (
    <div className="mt-4">
      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableCaption className="sr-only">Klanten</TableCaption>
          <TableHeader>
            <TableRow className="text-xs tracking-wide text-muted-foreground uppercase">
              <TableHead scope="col">Naam</TableHead>
              <TableHead scope="col">Adres</TableHead>
              <TableHead scope="col">Telefoon</TableHead>
              <TableHead scope="col" className="text-right">
                Taken
              </TableHead>
              <TableHead scope="col">Laatste taak</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={customerHref(row)}
                    className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatAddress(row) ?? <Unknown />}
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.phone ?? <Unknown />}</TableCell>
                <TableCell className="text-right tabular-nums">{row.taskCount}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.lastTaskDate ? (
                    formatDate(row.lastTaskDate)
                  ) : (
                    <span className="text-muted-foreground">Nog geen</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul
        aria-label="Klanten"
        className="divide-y divide-border rounded-lg border border-border bg-card md:hidden"
      >
        {rows.map((row) => {
          const address = formatAddress(row);
          return (
            <li key={row.id}>
              <Link
                href={customerHref(row)}
                className="grid gap-1 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="font-medium">{row.name}</span>
                {address ? <span className="text-sm text-muted-foreground">{address}</span> : null}
                {row.phone ? <span className="text-sm">{row.phone}</span> : null}
                <span className="text-sm text-muted-foreground">
                  {row.taskCount === 1 ? "1 taak" : `${row.taskCount} taken`}
                  {row.lastTaskDate ? ` · laatste uitgevoerd ${formatDate(row.lastTaskDate)}` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
