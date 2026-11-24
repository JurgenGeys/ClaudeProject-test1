import { z } from "zod";

import { LOGIN_MESSAGES } from "@/lib/auth/messages";

/**
 * Input of the login form. The e-mail address is only checked for being filled in: a
 * wrongly typed address gets the same "does not match" message as a wrong password, so the
 * screen never tells whether an address exists. The password is deliberately not trimmed.
 */
export const loginSchema = z.object({
  email: z.string().trim().min(1, { error: LOGIN_MESSAGES.emailRequired }),
  password: z.string().min(1, { error: LOGIN_MESSAGES.passwordRequired }),
});

export type LoginInput = z.infer<typeof loginSchema>;
