import { z } from "zod";

import { BELGIAN_POSTAL_CODE, optionalText, requiredText } from "./fields";
import { TEXT_LIMITS } from "@/lib/tasks/limits";

import { CUSTOMER_MESSAGES } from "./messages";

/**
 * A customer (design B6, and the "Nieuwe klant" block of B2). Only the name is required.
 * Empty optional fields become `null`.
 */
export const customerSchema = z.object({
  name: requiredText(CUSTOMER_MESSAGES.nameRequired, TEXT_LIMITS.name, CUSTOMER_MESSAGES.tooLong),
  street: optionalText(TEXT_LIMITS.street, CUSTOMER_MESSAGES.tooLong),
  postalCode: optionalText(10, CUSTOMER_MESSAGES.postalCodeInvalid).refine(
    (value) => value === null || BELGIAN_POSTAL_CODE.test(value),
    { error: CUSTOMER_MESSAGES.postalCodeInvalid },
  ),
  city: optionalText(TEXT_LIMITS.city, CUSTOMER_MESSAGES.tooLong),
  phone: optionalText(TEXT_LIMITS.phone, CUSTOMER_MESSAGES.tooLong),
  email: optionalText(TEXT_LIMITS.email, CUSTOMER_MESSAGES.emailInvalid).refine(
    (value) => value === null || z.email().safeParse(value).success,
    { error: CUSTOMER_MESSAGES.emailInvalid },
  ),
  notes: optionalText(TEXT_LIMITS.longText, CUSTOMER_MESSAGES.tooLong),
});

export type CustomerInput = z.infer<typeof customerSchema>;
