import { parseTaskNumber } from "./task-number";
import { versionSchema } from "./update-task";

/** The form of "Oppikken" (design T2): only the task number and the version of the page. */
export const PICK_UP_TASK_FIELDS = ["taskNumber", "version"] as const;

export type PickUpTaskParse =
  | { ok: true; data: { number: number; version: string } }
  /** The number or the version is missing or not valid: not a form that this page made. */
  | { ok: false };

/**
 * Reads and validates the form on the server. Nothing else is read: not the technician (he is
 * the user of the session), not the status and not a time. The version is the `updated_at`
 * the page was opened with, in the exact format that the page writes it (`queryTaskDetail`).
 */
export function parsePickUpTaskForm(formData: FormData): PickUpTaskParse {
  const number = parseTaskNumber(formData.get("taskNumber"));
  const version = versionSchema.safeParse(formData.get("version"));
  if (number === null || !version.success) {
    return { ok: false };
  }
  return { ok: true, data: { number, version: version.data } };
}
