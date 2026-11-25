import { z } from "zod";

import { CANCELLATION_REASON_MAX_LENGTH } from "@/lib/tasks/limits";

import { optionalText } from "./fields";
import { CANCELLATION_MESSAGES } from "./messages";

/** Input of "Taak annuleren" (design B3): the reason is optional, 500 characters at most. */
export const cancellationSchema = z.object({
  reason: optionalText(CANCELLATION_REASON_MAX_LENGTH, CANCELLATION_MESSAGES.reasonTooLong),
});

export type CancellationInput = z.infer<typeof cancellationSchema>;
