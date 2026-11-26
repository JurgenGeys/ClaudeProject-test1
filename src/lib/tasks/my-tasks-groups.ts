import { brusselsDayKey } from "@/lib/time/format";

import type { TaskStatus } from "./types";

/** What the grouping needs of a task of the technician. */
export type GroupableTask = {
  /** `2026-11-24`, the planned day (Belgian wall clock, A22). */
  scheduledDate: string;
  status: TaskStatus;
};

/** One day of the list: `dayKey` is `2026-11-24`; `relative` says whether it is today or tomorrow. */
export type DayGroup<T> = {
  dayKey: string;
  relative: "today" | "tomorrow" | null;
  tasks: T[];
};

/** The "Te doen" tab as the design shows it (T1): Bezig, Te laat, then per day. */
export type MyTasksGroups<T> = {
  /** Picked up tasks, always on top (K5: there can be several). */
  busy: T[];
  /** Assigned tasks with a planned day before today. */
  late: T[];
  /** Today and later, in order; days without tasks are not listed. */
  days: DayGroup<T>[];
};

/** `2026-11-30` plus one day is `2026-12-01`. Works on the calendar, so no time zone is involved. */
export function addDays(dayKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) {
    throw new RangeError(`Invalid day: ${dayKey}`);
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

/** Whether a planned day is today or tomorrow, in Belgian time (never the time zone of the server). */
export function relativeDay(dayKey: string, now: Date): "today" | "tomorrow" | null {
  const today = brusselsDayKey(now);
  if (dayKey === today) {
    return "today";
  }
  return dayKey === addDays(today, 1) ? "tomorrow" : null;
}

/**
 * Groups the open tasks of a technician (design T1, "Te doen"). The tasks must already be
 * sorted on planned day and start time; that order is kept inside every group.
 * - Picked up tasks are "Bezig", whatever their day.
 * - An assigned task whose day is before today (Belgian time) is "Te laat". A task of today is
 *   never late, even when its start time has passed: the design says "een datum in het verleden".
 * - The others are grouped per day, from today on.
 * Tasks in another status (finished, cancelled, not assigned) are not part of this tab and are left out.
 */
export function groupMyTasks<T extends GroupableTask>(tasks: T[], now: Date): MyTasksGroups<T> {
  const today = brusselsDayKey(now);
  const groups: MyTasksGroups<T> = { busy: [], late: [], days: [] };
  for (const task of tasks) {
    if (task.status === "picked_up") {
      groups.busy.push(task);
    } else if (task.status === "assigned") {
      if (task.scheduledDate < today) {
        groups.late.push(task);
        continue;
      }
      const last = groups.days.at(-1);
      if (last && last.dayKey === task.scheduledDate) {
        last.tasks.push(task);
      } else {
        groups.days.push({
          dayKey: task.scheduledDate,
          relative: relativeDay(task.scheduledDate, now),
          tasks: [task],
        });
      }
    }
  }
  return groups;
}
