import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTaskNumber, workTypeLabel } from "@/lib/tasks/labels";
import type { TaskOverviewRow } from "@/lib/tasks/overview";
import { formatDate, formatHours, formatTime, formatTimeOfDay } from "@/lib/time/format";

/** First non-empty line of the instructions: the short description in lists (design B2). */
export function firstLine(instructions: string): string {
  return (
    instructions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/** Where a task leads to. The task detail (B3) is built in BT-10. */
export function taskHref(row: Pick<TaskOverviewRow, "number">): string {
  return `/tasks/${row.number}`;
}

const planned = (row: TaskOverviewRow) =>
  `${formatDate(row.scheduledDate)} ${formatTimeOfDay(row.startTime)}`;

function Technician({ name }: { name: string | null }) {
  return name ? (
    <>{name}</>
  ) : (
    <span className="text-muted-foreground italic">Nog niet toegewezen</span>
  );
}

function StatusCell({ row }: { row: TaskOverviewRow }) {
  return (
    <>
      <StatusBadge status={row.status} />
      {row.status === "picked_up" && row.pickedUpAt ? (
        <span className="mt-0.5 block text-xs text-muted-foreground">
          sinds {formatTime(row.pickedUpAt)}
        </span>
      ) : null}
    </>
  );
}

function Hours({ row }: { row: TaskOverviewRow }) {
  if (row.minutes === null) {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          –
        </span>
        <span className="sr-only">geen uren</span>
      </>
    );
  }
  return (
    <>
      {formatHours(row.minutes)}
      {row.corrected ? (
        <span className="block text-xs font-normal text-muted-foreground">gecorrigeerd</span>
      ) : null}
    </>
  );
}

/**
 * The tasks as a table on a laptop (design B1) and as cards on a phone. Both are rendered and
 * CSS shows one of them (`hidden`/`md:hidden` is `display: none`, so a screen reader only
 * meets one), which keeps real table semantics on the laptop and a simple list on the phone.
 */
export function TaskList({ rows }: { rows: TaskOverviewRow[] }) {
  return (
    <div className="mt-4">
      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableCaption className="sr-only">Taken</TableCaption>
          <TableHeader>
            <TableRow className="text-xs tracking-wide text-muted-foreground uppercase">
              <TableHead scope="col">Nr.</TableHead>
              <TableHead scope="col">Gepland</TableHead>
              <TableHead scope="col">Klant</TableHead>
              <TableHead scope="col">Soort</TableHead>
              <TableHead scope="col">Instructies</TableHead>
              <TableHead scope="col">Technieker</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="text-right">
                Uren
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="tabular-nums">
                  <Link
                    href={taskHref(row)}
                    className="text-muted-foreground underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {formatTaskNumber(row.number)}
                  </Link>
                </TableCell>
                <TableCell>{planned(row)}</TableCell>
                <TableCell>
                  {/* A second, larger target for the task (the number alone is small). */}
                  <Link href={taskHref(row)} className="font-medium hover:underline">
                    {row.customerName}
                  </Link>
                  <span className="block text-muted-foreground">{row.city}</span>
                </TableCell>
                <TableCell>{workTypeLabel(row.workType)}</TableCell>
                <TableCell className="max-w-64 truncate" title={firstLine(row.instructions)}>
                  {firstLine(row.instructions)}
                </TableCell>
                <TableCell>
                  <Technician name={row.technicianName} />
                </TableCell>
                <TableCell>
                  <StatusCell row={row} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Hours row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul
        aria-label="Taken"
        className="divide-y divide-border rounded-lg border border-border bg-card md:hidden"
      >
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={taskHref(row)}
              className="grid gap-1 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {formatTaskNumber(row.number)}
                </span>
                {" · "}
                <span className="font-medium">{planned(row)}</span>
              </span>
              <span>
                <span className="font-medium">{row.customerName}</span>
                <span className="block text-sm text-muted-foreground">{row.city}</span>
              </span>
              <span className="text-sm">
                <span className="font-medium">{workTypeLabel(row.workType)}</span>
                {" · "}
                {firstLine(row.instructions)}
              </span>
              <span className="text-sm">
                <Technician name={row.technicianName} />
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <StatusCell row={row} />
                </span>
                {row.minutes !== null ? (
                  <span className="text-sm font-medium">
                    <Hours row={row} />
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
