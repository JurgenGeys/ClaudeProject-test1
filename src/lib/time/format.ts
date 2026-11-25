/**
 * Formatting of hours, dates and times for display and export (design chapter 3 and 6).
 * Everything is shown in `nl-BE` and in the time zone `Europe/Brussels`, whatever the
 * time zone of the server or the browser is. Only the standard library is used.
 */

export const LOCALE = "nl-BE";
export const TIME_ZONE = "Europe/Brussels";

/** Worked and estimated time is entered and stored per quarter of an hour. */
export const QUARTER_MINUTES = 15;

function assertMinutes(minutes: number): void {
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new RangeError(`Invalid number of minutes: ${minutes}`);
  }
}

/** True for a positive whole number of quarters of an hour (15, 30, 45, 60, ...). */
export function isQuarterHourMinutes(minutes: number): boolean {
  return Number.isSafeInteger(minutes) && minutes > 0 && minutes % QUARTER_MINUTES === 0;
}

/** 90 becomes `"1u30"`, 45 becomes `"0u45"`, 600 becomes `"10u00"`. */
export function formatHours(minutes: number): string {
  assertMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}u${String(rest).padStart(2, "0")}`;
}

const decimalFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** Hours with a decimal comma, for the export: 90 becomes `"1,5"`, 45 becomes `"0,75"`. */
export function formatHoursDecimal(minutes: number): string {
  assertMinutes(minutes);
  return decimalFormat.format(minutes / 60);
}

/** Minutes as a number of hours: 90 becomes 1.5. Exact for every quarter of an hour. */
export function minutesToHours(minutes: number): number {
  assertMinutes(minutes);
  return minutes / 60;
}

/**
 * Hours as minutes: 1.5 becomes 90. Throws when the value is not a whole number of quarters
 * (1.1 is refused instead of silently rounded), so a wrong value never reaches the database.
 */
export function hoursToMinutes(hours: number): number {
  const minutes = Math.round(hours * 60);
  if (!Number.isFinite(hours) || hours < 0 || Math.abs(hours * 60 - minutes) > 1e-9) {
    throw new RangeError(`Invalid number of hours: ${hours}`);
  }
  if (minutes % QUARTER_MINUTES !== 0) {
    throw new RangeError(`Hours must be a multiple of a quarter: ${hours}`);
  }
  return minutes;
}

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date: ${String(value)}`);
  }
  return date;
}

const dateParts = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type);
  if (!found) {
    throw new Error(`Missing ${type} in formatted date`);
  }
  return found.value;
}

/** `di 24/11/2026`, in Belgian time. */
export function formatDate(value: Date | string | number): string {
  const parts = dateParts.formatToParts(toDate(value));
  const weekday = part(parts, "weekday").replace(/\.$/, "");
  return `${weekday} ${part(parts, "day")}/${part(parts, "month")}/${part(parts, "year")}`;
}

/** `14:00`, in Belgian time (24 hour clock, midnight is `00:00`). */
export function formatTime(value: Date | string | number): string {
  return timeFormat.format(toDate(value));
}

/** `di 24/11/2026 14:00`, in Belgian time. */
export function formatDateTime(value: Date | string | number): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day in Belgium as `2026-11-24`. Use this to decide "today" or "tomorrow"
 * (design chapter 6), never the time zone of the server.
 */
export function brusselsDayKey(value: Date | string | number): string {
  const parts = dayKeyFormat.formatToParts(toDate(value));
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}
