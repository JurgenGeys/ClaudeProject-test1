import type { ZodType } from "zod";

/** The error messages of a failed parse per field name, or `null` when the input is valid. */
export function fieldErrors(schema: ZodType, input: unknown): Record<string, string[]> | null {
  const result = schema.safeParse(input);
  if (result.success) {
    return null;
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}
