import { z } from "zod";

import { QUARTER_MINUTES } from "@/lib/time/format";

/**
 * Building blocks of the task, customer and hours schemas. Forms send every field as text,
 * and an empty field arrives as `""`: optional fields turn that into `null`, so the database
 * never gets an empty string where it means "nothing".
 */

/**
 * Line endings as `\n`. A browser sends the line breaks of a textarea as `\r\n`; the database
 * and the lists (first line of the instructions) must see one kind.
 */
export function normalizeNewlines(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : value;
}

/** Required text: trimmed, not empty, with a technical maximum. */
export function requiredText(requiredMessage: string, max: number, tooLongMessage: string) {
  return z.preprocess(
    normalizeNewlines,
    z
      .string({ error: requiredMessage })
      .trim()
      .min(1, { error: requiredMessage })
      .max(max, { error: tooLongMessage }),
  );
}

/** Optional text: trimmed; missing, `null` and empty all become `null`. */
export function optionalText(max: number, tooLongMessage: string) {
  return z
    .preprocess(
      normalizeNewlines,
      z
        .string()
        .trim()
        .max(max, { error: tooLongMessage })
        .transform((value) => (value === "" ? null : value))
        .nullish(),
    )
    .transform((value) => value ?? null);
}

/**
 * Wraps a field that may be left out: missing, `null` and `""` (an empty form field) become
 * `null`, anything else must satisfy `schema`.
 */
export function optionalField<T extends z.ZodType>(schema: T) {
  return z
    .preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional())
    .transform((value) => value ?? null);
}

/** Belgian postal code: four digits. */
export const BELGIAN_POSTAL_CODE = /^\d{4}$/;

/** A calendar day as an `<input type="date">` sends it: `2026-11-24`, and the day must exist. */
export function isoDate(message: string) {
  return z
    .string({ error: message })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: message, abort: true })
    .refine(
      (value) => {
        const date = new Date(`${value}T12:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
      },
      { error: message },
    );
}

/** A start time as an `<input type="time">` sends it, per quarter of an hour: `14:00`, `14:15`. */
export function quarterTime(message: string) {
  return z
    .string({ error: message })
    .trim()
    .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, { error: message });
}

interface MinutesMessages {
  /** Empty, 0, negative or not a number. */
  required: string;
  notQuarter: string;
  tooMany: string;
}

/**
 * A number of minutes per quarter of an hour: at least 15, at most `max`. A text from a form
 * (`"90"`) is read as a number; an empty field counts as missing. The maximum is passed in
 * because each form has its own (see `src/lib/tasks/limits.ts`).
 */
export function quarterMinutes(max: number, messages: MinutesMessages) {
  return z.preprocess(
    (value) =>
      typeof value === "string" ? (value.trim() === "" ? undefined : Number(value)) : value,
    z.number({ error: messages.required }).superRefine((value, context) => {
      // One message per value: first "nothing", then "no whole quarter", then "too much".
      let message: string | null = null;
      if (value <= 0) {
        message = messages.required;
      } else if (!Number.isInteger(value) || value % QUARTER_MINUTES !== 0) {
        message = messages.notQuarter;
      } else if (value > max) {
        message = messages.tooMany;
      }
      if (message) {
        context.addIssue({ code: "custom", message });
      }
    }),
  );
}
