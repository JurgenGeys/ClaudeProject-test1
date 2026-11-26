import { z } from "zod";

/**
 * Name of the client's company, shown above the title of the login screen. Set per client in
 * `NEXT_PUBLIC_COMPANY_NAME`. It is shown in the browser, so it is not a secret. Empty or not
 * set means: show no name (not an error). Next.js only inlines `NEXT_PUBLIC_*` variables that
 * are written out literally, so it must be read exactly like this.
 */
export function getCompanyName(): string | undefined {
  return process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || undefined;
}

/** Digits, spaces and the usual separators, at least 6 digits (`014 00 00 00`, `+32 14 00 00 00`). */
const officePhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s./()-]{6,25}$/)
  .refine((value) => (value.match(/\d/g) ?? []).length >= 6);

/**
 * Phone number of the client's office, shown where the technician is told to call the office.
 * Set per client in `COMPANY_PHONE`. Only Server Components show it, so it has no
 * `NEXT_PUBLIC_` prefix and does not end up in the browser bundle. Empty, not set or not a phone
 * number means: show no sentence about calling the office (never an error or a wrong number).
 */
export function getCompanyPhone(): string | undefined {
  const parsed = officePhoneSchema.safeParse(process.env.COMPANY_PHONE);
  return parsed.success ? parsed.data : undefined;
}
