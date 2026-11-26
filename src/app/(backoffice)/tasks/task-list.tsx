import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { firstLine } from "@/lib/tasks/instructions";
import { INVOICE_MESSAGES } from "@/lib/tasks/invoice-messages";
import { formatTaskNumber, workTypeLabel } from "@/lib/tasks/labels";
import type { TaskOverviewRow } from "@/lib/tasks/overview";
import { formatDate, formatHours, formatTime, formatTimeOfDay } from "@/lib/time/format";

/** Where a task leads to. The task detail (B3) is built in BT-10. */
export function taskHref(row: Pick<TaskOverviewRow, "number">): string {
  return `/tasks/${row.number}`;
}

const planned = (row: TaskOverviewRow) =>
  `${formatDate(row.scheduledDate)} ${formatTimeOfDay(row.startTime)}`;

/**
 * The day the technician completed the task, in Belgian time (tab Afgewerkt: the list for
 * invoicing shows when the work was reported, not when it was planned).
 */
const completedDay = (row: TaskOverviewRow) =>
  row.completedAt ? formatDate(row.completedAt, { omitCurrentYear: true }) : "–";

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

/** Which rows are ticked, for the tab Afgewerkt (design B1, "Markeer als gefactureerd"). */
export type RowSelection = {
  /** Ids of the ticked rows. */
  selected: ReadonlySet<string>;
  onToggle: (row: TaskOverviewRow) => void;
  onToggleAll: () => void;
};

/**
 * A checkbox with a touch target of 44 px (the box itself is 16 px; follow-up of BT-04): the
 * box sits in a label of 44 by 44 px, so a tap beside it still counts.
 */
function TargetCheckbox({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean | "indeterminate";
  onCheckedChange: () => void;
  label: string;
}) {
  return (
    <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
        className="size-5"
      />
    </label>
  );
}

function allState(
  rows: TaskOverviewRow[],
  selected: ReadonlySet<string>,
): boolean | "indeterminate" {
  const count = rows.filter((row) => selected.has(row.id)).length;
  return count === 0 ? false : count === rows.length ? true : "indeterminate";
}

/**
 * The tasks as a table on a laptop (design B1) and as cards on a phone. Both are rendered and
 * CSS shows one of them (`hidden`/`md:hidden` is `display: none`, so a screen reader only
 * meets one), which keeps real table semantics on the laptop and a simple list on the phone.
 */
export function TaskList({
  rows,
  selection,
  completed = false,
}: {
  rows: TaskOverviewRow[];
  /**
   * The list of the tab Afgewerkt (design B1): the column "Afgemeld" instead of "Gepland", and
   * no status column, because every task is Afgewerkt.
   */
  completed?: boolean;
  /** Adds a checkbox to every row and one for all rows; without it the list is read only. */
  selection?: RowSelection;
}) {
  const allLabel = INVOICE_MESSAGES.selectAll + INVOICE_MESSAGES.selectAllScope;
  return (
    <div className="mt-4">
      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableCaption className="sr-only">Taken</TableCaption>
          <TableHeader>
            <TableRow className="text-xs tracking-wide text-muted-foreground uppercase">
              {selection ? (
                <TableHead scope="col" className="w-14">
                  <span className="sr-only">{INVOICE_MESSAGES.selectColumn}</span>
                  <TargetCheckbox
                    checked={allState(rows, selection.selected)}
                    onCheckedChange={selection.onToggleAll}
                    label={allLabel}
                  />
                </TableHead>
              ) : null}
              <TableHead scope="col">Nr.</TableHead>
              <TableHead scope="col">{completed ? "Afgemeld" : "Gepland"}</TableHead>
              <TableHead scope="col">Klant</TableHead>
              <TableHead scope="col">Soort</TableHead>
              <TableHead scope="col">Instructies</TableHead>
              <TableHead scope="col">Technieker</TableHead>
              {completed ? null : <TableHead scope="col">Status</TableHead>}
              <TableHead scope="col" className="text-right">
                Uren
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {selection ? (
                  <TableCell>
                    <TargetCheckbox
                      checked={selection.selected.has(row.id)}
                      onCheckedChange={() => selection.onToggle(row)}
                      label={INVOICE_MESSAGES.selectTask(row.number, row.customerName)}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="tabular-nums">
                  <Link
                    href={taskHref(row)}
                    className="text-muted-foreground underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {formatTaskNumber(row.number)}
                  </Link>
                </TableCell>
                <TableCell>{completed ? completedDay(row) : planned(row)}</TableCell>
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
                {completed ? null : (
                  <TableCell>
                    <StatusCell row={row} />
                  </TableCell>
                )}
                <TableCell className="text-right font-medium">
                  <Hours row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selection ? (
        <div className="flex items-center border-b border-border bg-card px-2 md:hidden">
          <TargetCheckbox
            checked={allState(rows, selection.selected)}
            onCheckedChange={selection.onToggleAll}
            label={allLabel}
          />
          <span aria-hidden="true" className="text-sm font-medium">
            {INVOICE_MESSAGES.selectAll}
          </span>
        </div>
      ) : null}
      <ul
        aria-label="Taken"
        className="divide-y divide-border rounded-lg border border-border bg-card md:hidden"
      >
        {rows.map((row) => (
          <li key={row.id} className={selection ? "flex items-stretch" : undefined}>
            {selection ? (
              <div className="flex items-start pt-1 pl-2">
                <TargetCheckbox
                  checked={selection.selected.has(row.id)}
                  onCheckedChange={() => selection.onToggle(row)}
                  label={INVOICE_MESSAGES.selectTask(row.number, row.customerName)}
                />
              </div>
            ) : null}
            <Link
              href={taskHref(row)}
              className={`grid gap-1 px-4 py-3 outline-none${selection ? " min-w-0 flex-1 pl-2" : ""} hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset`}
            >
              <span className="text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {formatTaskNumber(row.number)}
                </span>
                {" · "}
                <span className="font-medium">{completed ? completedDay(row) : planned(row)}</span>
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
                {completed ? null : (
                  <span>
                    <StatusCell row={row} />
                  </span>
                )}
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
