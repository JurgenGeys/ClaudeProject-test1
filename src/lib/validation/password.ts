import { z } from "zod";

import { PASSWORD_MESSAGES } from "./messages";

/** Minimum length from the design (G2: "Minstens 8 tekens"). Supabase itself only asks for 6. */
export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt, which Supabase Auth uses, cannot handle more than 72 bytes. */
const PASSWORD_MAX_BYTES = 72;

const encoder = new TextEncoder();

/**
 * Input of "Wachtwoord instellen" (design G2). The password is never trimmed: spaces are
 * allowed in a password. The second field must be the same as the first.
 */
export const passwordFormSchema = z
  .object({
    password: z
      .string({ error: PASSWORD_MESSAGES.tooShort })
      .min(PASSWORD_MIN_LENGTH, { error: PASSWORD_MESSAGES.tooShort })
      .refine((value) => encoder.encode(value).length <= PASSWORD_MAX_BYTES, {
        error: PASSWORD_MESSAGES.tooLong,
      }),
    confirmPassword: z.string({ error: PASSWORD_MESSAGES.mismatch }),
  })
  .superRefine((value, context) => {
    // Only compare when the first field is fine, so one problem gives one message.
    if (value.password.length >= PASSWORD_MIN_LENGTH && value.password !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: PASSWORD_MESSAGES.mismatch,
      });
    }
  });

export type PasswordFormInput = z.infer<typeof passwordFormSchema>;
