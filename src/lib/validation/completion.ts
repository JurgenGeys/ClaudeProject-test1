import { z } from "zod";

import { MAX_WORKED_MINUTES, NOTES_MAX_LENGTH } from "@/lib/tasks/limits";

import { optionalText, quarterMinutes } from "./fields";
import { COMPLETION_MESSAGES } from "./messages";

/**
 * Input of "Afmelden" (design T3): the hours at the customer, per quarter of an hour, 0u15
 * to 16u00, and optional notes. Travel time does not count (assumption A16).
 */
export const completionSchema = z.object({
  workedMinutes: quarterMinutes(MAX_WORKED_MINUTES, {
    required: COMPLETION_MESSAGES.minutesRequired,
    notQuarter: COMPLETION_MESSAGES.minutesNotQuarter,
    tooMany: COMPLETION_MESSAGES.minutesTooMany,
  }),
  notes: optionalText(NOTES_MAX_LENGTH, COMPLETION_MESSAGES.notesTooLong),
});

export type CompletionInput = z.infer<typeof completionSchema>;
