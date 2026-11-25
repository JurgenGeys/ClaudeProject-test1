import { z } from "zod";

import { FORGOT_PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { TEXT_LIMITS } from "@/lib/tasks/limits";

/**
 * Input of "Wachtwoord vergeten" (design G3): an e-mail address. Trimmed and lower-cased,
 * because Supabase Auth treats addresses case-insensitively and `profiles.email` is stored
 * that way. Only the format is checked: whether the address exists is never told.
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string({ error: FORGOT_PASSWORD_MESSAGES.emailRequired })
    .trim()
    .toLowerCase()
    .min(1, { error: FORGOT_PASSWORD_MESSAGES.emailRequired })
    .max(TEXT_LIMITS.email, { error: FORGOT_PASSWORD_MESSAGES.emailInvalid })
    .pipe(z.email({ error: FORGOT_PASSWORD_MESSAGES.emailInvalid })),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
