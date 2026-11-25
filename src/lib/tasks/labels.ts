import type { TaskStatus, WorkType } from "./types";

/**
 * Dutch labels that users see. `Record` makes TypeScript fail the build when a status or
 * work type is added without a label. The same labels are used in the CSV export (design
 * chapter 5), so they live here and nowhere else.
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  assigned: "Toegewezen",
  picked_up: "Opgepikt",
  completed: "Afgewerkt",
  invoiced: "Gefactureerd",
  cancelled: "Geannuleerd",
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  inspection: "Nazicht",
  maintenance: "Onderhoud",
  repair: "Herstelling",
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function workTypeLabel(workType: WorkType): string {
  return WORK_TYPE_LABELS[workType];
}

/**
 * Task number as users see it: `#1042` (design chapter 3, proposal P5). The number comes from
 * the database (identity column from 1001) and is never typed in by a user.
 */
export function formatTaskNumber(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RangeError(`Invalid task number: ${number}`);
  }
  return `#${number}`;
}
