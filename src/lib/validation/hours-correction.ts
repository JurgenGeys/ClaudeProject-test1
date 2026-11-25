import { z } from "zod";

import { CORRECTION_REASON_MAX_LENGTH, MAX_CORRECTED_MINUTES } from "@/lib/tasks/limits";

import { quarterMinutes, requiredText } from "./fields";
import { CORRECTION_MESSAGES } from "./messages";

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
