import { z } from "zod";

import { CORRECTION_REASON_MAX_LENGTH, MAX_CORRECTED_MINUTES } from "@/lib/tasks/limits";

import { quarterMinutes, requiredText } from "./fields";
import { CORRECTION_MESSAGES } from "./messages";
import { parseTaskNumber } from "./task-number";
import { versionSchema } from "./update-task";

/**
 * Input of "Uren corrigeren" (design B3): the new hours per quarter of an hour and a required
 * reason. The maximum of the hours is `MAX_CORRECTED_MINUTES`: a technical safety limit until
 * Jurgen decides (see `src/lib/tasks/limits.ts`).
 */
export const hoursCorrectionSchema = z.object({
  correctedMinutes: quarterMinutes(MAX_CORRECTED_MINUTES, {
    required: CORRECTION_MESSAGES.minutesRequired,
    notQuarter: CORRECTION_MESSAGES.minutesNotQuarter,
    tooMany: CORRECTION_MESSAGES.minutesTooMany,
  }),
  reason: requiredText(
    CORRECTION_MESSAGES.reasonRequired,
    CORRECTION_REASON_MAX_LENGTH,
    CORRECTION_MESSAGES.reasonTooLong,
  ),
});

export type HoursCorrectionInput = z.infer<typeof hoursCorrectionSchema>;

export type CorrectHoursFieldErrors = Partial<Record<"correctedMinutes" | "reason", string>>;

export type CorrectHoursData = HoursCorrectionInput & {
  number: number;
  /** `updated_at` as `2026-11-25T18:44:00.123456Z`, as the page read it. */
  version: string;
};

export type CorrectHoursParse =
  | { ok: true; data: CorrectHoursData }
  /** The number or the version is missing or not valid: not a form that this page made. */
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "fields"; fieldErrors: CorrectHoursFieldErrors };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Reads and validates the form of "Uren corrigeren" on the server: the task number, the version
 * of the page, the new hours and the reason. Nothing else is read: not the status, not the
 * original hours and not the user.
 */
export function parseCorrectHoursForm(formData: FormData): CorrectHoursParse {
  const number = parseTaskNumber(formData.get("taskNumber"));
  const version = versionSchema.safeParse(formData.get("version"));
  if (number === null || !version.success) {
    return { ok: false, reason: "stale" };
  }
  const fields = hoursCorrectionSchema.safeParse({
    correctedMinutes: text(formData, "correctedMinutes"),
    reason: text(formData, "reason"),
  });
  if (!fields.success) {
    const fieldErrors: CorrectHoursFieldErrors = {};
    for (const issue of fields.error.issues) {
      const key = issue.path[0];
      if ((key === "correctedMinutes" || key === "reason") && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, reason: "fields", fieldErrors };
  }
  return { ok: true, data: { number, version: version.data, ...fields.data } };
}
