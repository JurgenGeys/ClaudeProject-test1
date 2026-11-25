import { z } from "zod";

import { TEXT_LIMITS } from "@/lib/tasks/limits";

import { requiredText } from "./fields";
import { TECHNICIAN_MESSAGES } from "./messages";

/**
 * Input of "Technieker toevoegen" (design B7): a name and an e-mail address. The address is
 * trimmed and lower-cased, because Supabase Auth treats addresses case-insensitively and
 * `profiles.email` must match what Auth stores.
 */
export const technicianSchema = z.object({
  fullName: requiredText(
    TECHNICIAN_MESSAGES.nameRequired,
    TEXT_LIMITS.name,
    TECHNICIAN_MESSAGES.tooLong,
  ),
  email: z
    .string({ error: TECHNICIAN_MESSAGES.emailInvalid })
    .trim()
    .toLowerCase()
    .max(TEXT_LIMITS.email, { error: TECHNICIAN_MESSAGES.emailInvalid })
    .pipe(z.email({ error: TECHNICIAN_MESSAGES.emailInvalid })),
});

export type TechnicianInput = z.infer<typeof technicianSchema>;

/** Id of a technician, as the "opnieuw versturen" form sends it. */
export const technicianIdSchema = z.uuid();
