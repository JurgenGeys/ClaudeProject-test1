import { formatHoursDecimal } from "@/lib/time/format";
import { taskStatusLabel, workTypeLabel } from "@/lib/tasks/labels";
import type { TaskStatus, WorkType } from "@/lib/tasks/types";

/**
 * The CSV export for invoicing (design B4 and chapter 6, decision K3). Pure functions, no
 * database and no framework, so they are easy to test.
 *
 * Format, as the design decided: separator `;`, UTF-8 with a byte order mark (BOM), a decimal
 * comma, and CRLF between lines. Belgian Excel opens this directly with the right columns and
 * accents.
 */

export const CSV_SEPARATOR = ";";
export const CSV_BOM = "﻿";
export const CSV_LINE_BREAK = "\r\n";

/** The headers of the file, in order (design B4). */
export const EXPORT_COLUMNS = [
  "Taaknummer",
  "Datum",
  "Klant",
  "Adres",
  "Technieker",
  "Soort werk",
  "Omschrijving",
  "Gewerkte uren",
  "Notities",
  "Status",
] as const;

/** One task of the export, as the query returns it. */
export type ExportRow = {
  number: number;
  /** The day the technician completed the task (Belgian time) as `2026-11-24`: the period of the export. */
  completedDay: string;
  customerName: string;
  /** The place of work of the task (not necessarily the address of the customer). */
  street: string;
  postalCode: string;
  city: string;
  /** `null` should not happen for a finished task (database check), but is exported as empty. */
  technicianName: string | null;
  workType: WorkType;
  instructions: string;
  /** The hours that count: the correction if there is one, otherwise the technician's hours. */
  minutes: number;
  notes: string | null;
  status: Extract<TaskStatus, "completed" | "invoiced">;
};

/**
 * Protection against formula injection (OWASP "CSV injection"): a cell that starts with `=`,
 * `+`, `-` or `@` (the design), or with a tab or carriage return (which spreadsheets also treat
 * as the start of a formula), gets a `'` in front, so Excel shows text instead of running it.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * One text cell: neutralized against formulas, and put between double quotes (with the quotes
 * inside doubled) when it holds the separator, a quote or a line break.
 */
export function csvTextCell(value: string): string {
  const safe = neutralizeFormula(value);
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** `2026-11-02` as `02/11/2026`. Throws for anything that is not a plain date. */
export function formatExportDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    throw new RangeError(`Invalid date: ${day}`);
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** The line of one task, without the line break. */
export function csvRow(row: ExportRow): string {
  const address = `${row.street}, ${row.postalCode} ${row.city}`;
  return [
    // A plain number (1042, without `#`), so Excel can sort on it. Not text: nothing to neutralize.
    String(row.number),
    formatExportDate(row.completedDay),
    csvTextCell(row.customerName),
    csvTextCell(address),
    csvTextCell(row.technicianName ?? ""),
    csvTextCell(workTypeLabel(row.workType)),
    csvTextCell(row.instructions),
    // `1,5`: a number with a decimal comma. It contains no separator and never starts with a sign.
    formatHoursDecimal(row.minutes),
    csvTextCell(row.notes ?? ""),
    csvTextCell(taskStatusLabel(row.status)),
  ].join(CSV_SEPARATOR);
}

/** The whole file: BOM, header line and one line per task, each ending in CRLF. */
export function buildCsv(rows: readonly ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(CSV_SEPARATOR), ...rows.map(csvRow)];
  return CSV_BOM + lines.join(CSV_LINE_BREAK) + CSV_LINE_BREAK;
}

/** `taken-2026-11-01-tot-2026-11-30.csv`. Only built from validated dates, so always a safe name. */
export function exportFilename(from: string, to: string): string {
  for (const day of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new RangeError(`Invalid date: ${day}`);
    }
  }
  return `taken-${from}-tot-${to}.csv`;
}
