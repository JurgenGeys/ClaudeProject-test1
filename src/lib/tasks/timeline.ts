import { formatDate, formatHours, formatTime } from "@/lib/time/format";

import type { TaskDetail } from "./detail";

/** One line of the timeline of B3. `pending` is a step that did not happen yet (muted). */
export type TimelineItem = {
  key: string;
  title: string;
  detail?: string;
  pending?: boolean;
  /** The step that gets a color in the design: picked up, completed, invoiced or cancelled. */
  emphasis?: "picked_up" | "completed" | "invoiced" | "cancelled";
};

/** `ma 23/11/2026 om 11:20`, in Belgian time. */
export function formatMoment(value: Date): string {
  return `${formatDate(value)} om ${formatTime(value)}`;
}

/**
 * The timeline of design B3, built from the fields of the task (there is no status history,
 * design chapter 5): created, assigned, picked up, completed, corrected, invoiced, cancelled.
 * A step that has not happened yet is shown muted ("Nog niet opgepikt"), as in the mockups,
 * except for a cancelled task: it will not happen any more.
 */
export function buildTimeline(task: TaskDetail): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      key: "created",
      title: "Aangemaakt",
      detail: `${formatMoment(task.createdAt)} door ${task.createdByName}`,
    },
  ];
  if (task.assignee) {
    items.push({ key: "assigned", title: `Toegewezen aan ${task.assignee.fullName}` });
  }

  if (task.status === "cancelled") {
    if (task.cancelledAt) {
      items.push({
        key: "cancelled",
        title: "Geannuleerd",
        detail: `${formatMoment(task.cancelledAt)}${task.cancelledByName ? ` door ${task.cancelledByName}` : ""}`,
        emphasis: "cancelled",
      });
    }
    return items;
  }

  if (task.pickedUpAt) {
    items.push({
      key: "picked_up",
      title: "Opgepikt",
      detail: formatMoment(task.pickedUpAt),
      emphasis: "picked_up",
    });
  } else {
    items.push({ key: "picked_up", title: "Nog niet opgepikt", pending: true });
  }

  if (task.completion) {
    const { completion } = task;
    items.push({
      key: "completed",
      title: "Afgemeld",
      detail: `${formatMoment(completion.completedAt)} · ${formatHours(completion.workedMinutes)}`,
      emphasis: "completed",
    });
    if (completion.correctedMinutes !== null && completion.correctedAt) {
      items.push({
        key: "corrected",
        title: `Uren gecorrigeerd naar ${formatHours(completion.correctedMinutes)}`,
        detail: `${formatMoment(completion.correctedAt)}${completion.correctedByName ? ` door ${completion.correctedByName}` : ""}`,
      });
    }
    if (task.invoicedAt) {
      items.push({
        key: "invoiced",
        title: "Gefactureerd",
        detail: `${formatMoment(task.invoicedAt)}${task.invoicedByName ? ` door ${task.invoicedByName}` : ""}`,
        emphasis: "invoiced",
      });
    } else {
      items.push({ key: "invoiced", title: "Nog niet gefactureerd", pending: true });
    }
  } else if (task.status === "picked_up") {
    items.push({ key: "completed", title: "Nog niet afgemeld", pending: true });
  }

  return items;
}
