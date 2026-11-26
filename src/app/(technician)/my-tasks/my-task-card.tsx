import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { firstLine } from "@/lib/tasks/instructions";
import { formatTaskNumber, workTypeLabel } from "@/lib/tasks/labels";
import type { MyDoneTask, MyOpenTask } from "@/lib/tasks/my-tasks";
import { relativeDay } from "@/lib/tasks/my-tasks-groups";
import { formatDate, formatHours, formatTimeOfDay } from "@/lib/time/format";
import { cn } from "@/lib/utils";

/** Where a task leads to: T2, by its number. */
export function myTaskHref(task: { number: number }): string {
  return `/my-tasks/${task.number}`;
}

/** `ca. 1u30`: the estimated duration, or nothing when there is none. */
function estimate(task: Pick<MyOpenTask, "estimatedMinutes">): string[] {
  return task.estimatedMinutes === null ? [] : [`ca. ${formatHours(task.estimatedMinutes)}`];
}

/** `Vandaag`, `Morgen` or `ma 23/11` (with the year when it is not this year). */
function dayWord(task: Pick<MyOpenTask, "scheduledDate">, now: Date): string {
  const relative = relativeDay(task.scheduledDate, now);
  if (relative === "today") {
    return "Vandaag";
  }
  return relative === "tomorrow"
    ? "Morgen"
    : formatDate(task.scheduledDate, { omitCurrentYear: true, now });
}

/**
 * How a card says when the task is planned:
 * - `time`: inside a day group the day is in the heading, so only `08:00`;
 * - `day`: where the day is not in a heading (Bezig, Te laat) the day comes first.
 */
export type CardWhen = "time" | "day";

const LATE_CLASSES = "border-red-200";
const BUSY_CLASSES = "border-2 border-amber-400 bg-amber-50";

/**
 * A task of the "Te doen" tab (design T1): when, estimated duration and number, customer,
 * city, status label, kind of work and the first line of the instructions. The whole card is
 * one link to T2 (much bigger than 44 px). The card for a picked up task is the orange
 * "Bezig" one; a late card writes its day in red (never only color: the section says "Te laat").
 */
export function MyTaskCard({
  task,
  now,
  when,
  late = false,
}: {
  task: MyOpenTask;
  now: Date;
  when: CardWhen;
  late?: boolean;
}) {
  const busy = task.status === "picked_up";
  const time = formatTimeOfDay(task.startTime);
  const parts = [
    when === "day" ? `${dayWord(task, now)} ${time}` : time,
    ...estimate(task),
    formatTaskNumber(task.number),
  ];
  const description = firstLine(task.instructions);
  return (
    <Link
      href={myTaskHref(task)}
      className={cn(
        "block rounded-lg border bg-card p-4 shadow-sm outline-none hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        busy ? BUSY_CLASSES : late ? LATE_CLASSES : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-sm", late ? "font-medium text-red-700" : "text-slate-600")}>
            {parts.join(" · ")}
          </p>
          <p className="mt-0.5 text-lg font-semibold break-words">{task.customerName}</p>
          <p className="text-sm text-slate-600">{task.city}</p>
        </div>
        <StatusBadge status={task.status} className="shrink-0" />
      </div>
      <p className="mt-2 text-sm text-slate-700">
        <span className="font-semibold text-foreground">{workTypeLabel(task.workType)}</span>
        {description ? ` · ${description}` : ""}
      </p>
    </Link>
  );
}

/**
 * A line of the "Afgewerkt" tab (design T1): customer, planned day and city, number and kind
 * of work, the hours the technician filled in, and the label "Afgewerkt" (a task that is
 * invoiced shows the same: the technician does not need to know).
 */
export function MyDoneItem({ task, now }: { task: MyDoneTask; now: Date }) {
  return (
    <li>
      <Link
        href={myTaskHref(task)}
        className="flex min-h-11 items-center justify-between gap-3 p-4 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <span className="min-w-0">
          <span className="block font-medium break-words">{task.customerName}</span>
          <span className="block text-sm text-slate-600">
            {formatDate(task.scheduledDate, { omitCurrentYear: true, now })} · {task.city}
          </span>
          <span className="block text-xs text-slate-600">
            {formatTaskNumber(task.number)} · {workTypeLabel(task.workType)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold">{formatHours(task.workedMinutes)}</span>
          <span className="block text-xs text-green-800">Afgewerkt</span>
        </span>
      </Link>
    </li>
  );
}
