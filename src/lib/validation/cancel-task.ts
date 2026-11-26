import { cancellationSchema } from "./cancellation";
import { parseTaskNumber } from "./task-number";
import { versionSchema } from "./update-task";

/**
 * The form of "Taak annuleren" (design B3): the task number, the version of the page and the
 * reason (not required, 500 characters at most). Nothing else is read: not the status, not who
 * cancels and not a time (the database clock sets that).
 */
export type CancelTaskFieldErrors = Partial<Record<"reason", string>>;

export type CancelTaskData = {
  number: number;
  /** `updated_at` as `2026-11-25T18:44:00.123456Z`, as the page read it. */
  version: string;
  /** Trimmed; `null` when left empty. */
  reason: string | null;
};

export type CancelTaskParse =
  | { ok: true; data: CancelTaskData }
  /** The number or the version is missing or not valid: not a form that this page made. */
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "fields"; fieldErrors: CancelTaskFieldErrors };

/** Reads and validates the form on the server. */
export function parseCancelTaskForm(formData: FormData): CancelTaskParse {
  const number = parseTaskNumber(formData.get("taskNumber"));
  const version = versionSchema.safeParse(formData.get("version"));
  if (number === null || !version.success) {
    return { ok: false, reason: "stale" };
  }
  const reason = formData.get("reason");
  const parsed = cancellationSchema.safeParse({ reason: typeof reason === "string" ? reason : "" });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { ok: false, reason: "fields", fieldErrors: message ? { reason: message } : {} };
  }
  return { ok: true, data: { number, version: version.data, reason: parsed.data.reason } };
}
