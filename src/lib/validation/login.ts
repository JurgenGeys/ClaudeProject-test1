import { z } from "zod";

import { LOGIN_MESSAGES } from "@/lib/auth/messages";

/**
 * Input of the login form. The e-mail address is only checked for being filled in: a
 * wrongly typed address gets the same "does not match" message as a wrong password, so the
 * screen never tells whether an address exists. The password is deliberately not trimmed.
 */
export const loginSchema = z.object({
  // 320 is the longest valid e-mail address; 1024 keeps absurd input away from the Auth server.
  email: z
    .string()
    .trim()
    .min(1, { error: LOGIN_MESSAGES.emailRequired })
    .max(320, { error: LOGIN_MESSAGES.emailTooLong }),
  password: z
    .string()
    .min(1, { error: LOGIN_MESSAGES.passwordRequired })
    .max(1024, { error: LOGIN_MESSAGES.passwordTooLong }),
});

export type LoginInput = z.infer<typeof loginSchema>;
