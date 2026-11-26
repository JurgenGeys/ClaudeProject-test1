import { z } from "zod";

/**
 * The task number in an address (`/tasks/1043`) or a form (design chapter 6). Strict: plain
 * digits, no leading zero, no sign, no spaces, at most 9 digits (the column is a 32-bit
 * integer). Anything else is "not found", never an error from the database.
 */
const taskNumberSchema = z
  .string()
  .regex(/^[1-9]\d{0,8}$/)
  .transform(Number);

/** The task number, or `null` for anything that is not one (including a missing value). */
export function parseTaskNumber(value: unknown): number | null {
  const parsed = taskNumberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
