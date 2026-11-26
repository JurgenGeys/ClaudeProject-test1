import { completionSchema } from "./completion";
import { parseTaskNumber } from "./task-number";
import { versionSchema } from "./update-task";

/** The fields of "Taak afmelden" (design T3). Nothing else is ever read from the form. */
export const COMPLETE_TASK_FIELDS = ["taskNumber", "version", "workedMinutes", "notes"] as const;

export type CompleteTaskFieldErrors = { workedMinutes?: string; notes?: string };

export type CompleteTaskParse =
  | {
      ok: true;
      data: { number: number; version: string; workedMinutes: number; notes: string | null };
    }
  /** The number, the version or the type of a field is wrong: not a form that this page made. */
  | { ok: false; kind: "invalid-form" }
  | { ok: false; kind: "fields"; fieldErrors: CompleteTaskFieldErrors };

/**
 * Reads and validates the form on the server (design T3): the task number, the version of the
 * page, the worked minutes (a multiple of 15, 15 to 960) and the notes (at most 2000 characters).
 * The technician is the user of the session, so he is not a field here.
 */
export function parseCompleteTaskForm(formData: FormData): CompleteTaskParse {
  const number = parseTaskNumber(formData.get("taskNumber"));
  const version = versionSchema.safeParse(formData.get("version"));
  const minutes = formData.get("workedMinutes");
  const notes = formData.get("notes");
  if (
    number === null ||
    !version.success ||
    (minutes !== null && typeof minutes !== "string") ||
    (notes !== null && typeof notes !== "string")
  ) {
    return { ok: false, kind: "invalid-form" };
  }

  const parsed = completionSchema.safeParse({ workedMinutes: minutes, notes });
  if (!parsed.success) {
    const fieldErrors: CompleteTaskFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "workedMinutes" || key === "notes") && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, kind: "fields", fieldErrors };
  }
  return {
    ok: true,
    data: {
      number,
      version: version.data,
      workedMinutes: parsed.data.workedMinutes,
      notes: parsed.data.notes,
    },
  };
}
