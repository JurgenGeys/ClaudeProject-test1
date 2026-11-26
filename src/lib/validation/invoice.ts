import { z } from "zod";

import { PAGE_SIZE } from "./task-overview";
import { parseTaskNumber } from "./task-number";
import { versionSchema } from "./update-task";

/**
 * The forms of "Markeer als gefactureerd" and "Markering ongedaan maken" (design B1 and B3).
 * Only task numbers and versions are read: not the status, not who does it, not a time.
 */

/** Name of the repeated form field that holds one `<number>@<version>` per selected task. */
export const INVOICE_TASK_FIELD = "task";

/**
 * The most tasks of one request. The selection is per page of the overview, so a page is the
 * natural limit; more than that is not a form that the page made.
 */
export const MAX_INVOICE_SELECTION = PAGE_SIZE;

/** Where the request comes from: the selection in the overview, or the page of one task. */
export const invoiceViews = ["list", "task"] as const;
export type InvoiceView = (typeof invoiceViews)[number];

/** A task and the version of it that the page showed. */
export type InvoiceTaskRef = { number: number; version: string };

/** `1043@2026-11-25T18:44:00.123456Z` as the pair it stands for, or `null`. */
export function parseTaskRef(value: unknown): InvoiceTaskRef | null {
  if (typeof value !== "string" || value.length > 64) {
    return null;
  }
  const at = value.indexOf("@");
  const number = parseTaskNumber(at < 0 ? null : value.slice(0, at));
  const version = versionSchema.safeParse(at < 0 ? null : value.slice(at + 1));
  return number !== null && version.success ? { number, version: version.data } : null;
}

/** The text of a form field for a task; the counterpart of `parseTaskRef`. */
export function formatTaskRef(ref: InvoiceTaskRef): string {
  return `${ref.number}@${ref.version}`;
}

const taskRefSchema = z.string().transform((value, ctx) => {
  const ref = parseTaskRef(value);
  if (!ref) {
    ctx.issues.push({ code: "custom", message: "Not a task reference.", input: value });
    return z.NEVER;
  }
  return ref;
});

const markSchema = z
  .object({
    tasks: z
      .array(taskRefSchema)
      .min(1)
      .max(MAX_INVOICE_SELECTION)
      // The same task twice is not what the page sends.
      .refine((refs) => new Set(refs.map((ref) => ref.number)).size === refs.length),
    view: z.enum(invoiceViews),
  })
  .refine(
    // The page of one task marks that task and nothing else.
    (form) => form.view !== "task" || form.tasks.length === 1,
  );

export type MarkInvoicedParse =
  | { ok: true; data: { tasks: InvoiceTaskRef[]; view: InvoiceView } }
  /** Not a form that one of the pages made. */
  | { ok: false };

/** Reads and validates the form of `markInvoiced` on the server. */
export function parseMarkInvoicedForm(formData: FormData): MarkInvoicedParse {
  const parsed = markSchema.safeParse({
    tasks: formData.getAll(INVOICE_TASK_FIELD),
    view: formData.get("view"),
  });
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

export type UnmarkInvoicedParse = { ok: true; data: InvoiceTaskRef } | { ok: false };

/** Reads and validates the form of `unmarkInvoiced`: one task and its version. */
export function parseUnmarkInvoicedForm(formData: FormData): UnmarkInvoicedParse {
  const ref = parseTaskRef(formData.get(INVOICE_TASK_FIELD));
  return ref ? { ok: true, data: ref } : { ok: false };
}
