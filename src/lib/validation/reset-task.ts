import { z } from "zod";

import { isoDate, quarterTime } from "./fields";
import { TASK_MESSAGES } from "./messages";
import { parseTaskNumber } from "./task-number";
import { versionSchema } from "./update-task";

/**
 * The form of "Terugzetten" (design B3): the task number, the version of the page, and the three
 * fields of the dialog (technician, date, start time). Nothing else is read: not the status and
 * not a time of picking up (that is cleared).
 */
export type ResetTaskFieldErrors = Partial<
  Record<"assigneeId" | "scheduledDate" | "startTime", string>
>;

export type ResetTaskData = {
  number: number;
  /** `updated_at` as `2026-11-25T18:44:00.123456Z`, as the page read it. */
  version: string;
  assigneeId: string;
  scheduledDate: string;
  startTime: string;
};

export type ResetTaskParse =
  | { ok: true; data: ResetTaskData }
  /** The number or the version is missing or not valid: not a form that this page made. */
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "fields"; fieldErrors: ResetTaskFieldErrors };

const fieldsSchema = z.object({
  // Unlike editing, a reset always has a technician: there is no "Nog niet toewijzen".
  assigneeId: z.uuid({ error: TASK_MESSAGES.assigneeInvalid }),
  scheduledDate: isoDate(TASK_MESSAGES.dateRequired),
  startTime: quarterTime(TASK_MESSAGES.startTimeRequired),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Reads and validates the form on the server. */
export function parseResetTaskForm(formData: FormData): ResetTaskParse {
  const number = parseTaskNumber(formData.get("taskNumber"));
  const version = versionSchema.safeParse(formData.get("version"));
  if (number === null || !version.success) {
    return { ok: false, reason: "stale" };
  }
  const fields = fieldsSchema.safeParse({
    assigneeId: text(formData, "assigneeId"),
    scheduledDate: text(formData, "scheduledDate"),
    startTime: text(formData, "startTime"),
  });
  if (!fields.success) {
    const fieldErrors: ResetTaskFieldErrors = {};
    for (const issue of fields.error.issues) {
      const key = issue.path[0];
      if (
        (key === "assigneeId" || key === "scheduledDate" || key === "startTime") &&
        !fieldErrors[key]
      ) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, reason: "fields", fieldErrors };
  }
  return { ok: true, data: { number, version: version.data, ...fields.data } };
}
