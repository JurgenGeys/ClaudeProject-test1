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

/** Like `assertMinutes`, but also refuses minutes that are not a whole number of quarters. */
function assertQuarterMinutes(minutes: number): void {
  assertMinutes(minutes);
  if (minutes % QUARTER_MINUTES !== 0) {
    throw new RangeError(`Minutes must be a multiple of ${QUARTER_MINUTES}: ${minutes}`);
  }
}

/**
 * The rule for worked time (design chapter 5): more than 0 and a multiple of 15 minutes.
 * `0`, `-0`, negative numbers, fractions, `NaN` and `Infinity` are not valid.
 *
 * There is no upper limit here. The maximum per screen belongs in the Zod schema of the build
 * task that needs it: BT-13 (T3 Afmelden) uses 16u00 as the design says; the maximum for
 * "Uren corrigeren" (B3) and for the estimated duration (B2) still has to be decided.
 */
export function isValidWorkedMinutes(minutes: number): boolean {
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

/**
 * Hours with a decimal comma, for the export: 90 becomes `"1,5"`, 45 becomes `"0,75"`.
 * Throws for minutes that are not a whole number of quarters: those would be rounded wrongly
 * (20 minutes is not 0,33 hours) and do not exist in the database (check constraint).
 */
export function formatHoursDecimal(minutes: number): string {
  assertQuarterMinutes(minutes);
  return decimalFormat.format(minutes / 60);
}

/**
 * Spoken form for screen readers (`aria-label`): 90 becomes `"1 uur 30 minuten"`, 45 becomes
 * `"45 minuten"`, 120 becomes `"2 uur"`, 1 becomes `"1 minuut"`.
 */
export function formatHoursSpoken(minutes: number): string {
  assertMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} uur`);
  }
  if (rest > 0 || hours === 0) {
    parts.push(`${rest} ${rest === 1 ? "minuut" : "minuten"}`);
  }
  return parts.join(" ");
}

/** Minutes as a number of hours: 90 becomes 1.5. Exact for every quarter of an hour. */
export function minutesToHours(minutes: number): number {
  assertMinutes(minutes);
  return minutes === 0 ? 0 : minutes / 60; // never -0
}

/**
 * Hours as minutes: 1.5 becomes 90. Throws when the value is not a whole number of quarters
 * (1.1 is refused instead of silently rounded) or is negative, so a wrong value never reaches
 * the database. 0 is allowed (the start value of a stepper) and the result is never `-0`.
 * It has no upper limit: see `isValidWorkedMinutes`.
 */
export function hoursToMinutes(hours: number): number {
  const minutes = Math.round(hours * 60);
  if (!Number.isFinite(hours) || hours < 0 || Math.abs(hours * 60 - minutes) > 1e-9) {
    throw new RangeError(`Invalid number of hours: ${hours}`);
  }
  if (minutes % QUARTER_MINUTES !== 0) {
    throw new RangeError(`Hours must be a multiple of a quarter: ${hours}`);
  }
  return minutes === 0 ? 0 : minutes;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// Date and time with an explicit time zone: `Z`, `+01:00`, `+0100` or Postgres' `+01`.
const DATE_TIME_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function isRealDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * A moment as a `Date`. Accepts a `Date`, a timestamp and an ISO string **with** a time zone
 * (`2026-11-24T13:00:00Z`, `2026-11-24 14:00:00+01`). A string without a time zone
 * (`2026-11-24T14:00:00`) is refused with a `RangeError`: it would be read in the time zone of
 * the server or the browser, which differs. A `date` without time (`2026-11-24`) is only
 * accepted with `allowDateOnly`, and then means that calendar day in Belgium.
 */
function toDate(value: Date | string | number, allowDateOnly = false): Date {
  if (typeof value === "string") {
    const dateOnly = DATE_ONLY.exec(value);
    if (dateOnly) {
      const [year, month, day] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];
      if (!allowDateOnly || !isRealDay(year, month, day)) {
        throw new RangeError(`Invalid date: ${value}`);
      }
      // Noon UTC is the same calendar day in Belgium (UTC+1 or UTC+2), never the day before.
      return new Date(Date.UTC(year, month - 1, day, 12));
    }
    const dateTime = DATE_TIME_WITH_ZONE.exec(value);
    if (
      !dateTime ||
      !isRealDay(Number(dateTime[1]), Number(dateTime[2]), Number(dateTime[3])) ||
      Number(dateTime[4]) > 23 ||
      Number(dateTime[5]) > 59 ||
      Number(dateTime[6] ?? 0) > 59
    ) {
      throw new RangeError(`Invalid date, or no time zone given: ${value}`);
    }
    let zone = dateTime[7];
    if (zone !== "Z") {
      const digits = zone.slice(1).replace(":", "");
      zone = `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2) || "00"}`;
    }
    const iso = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6] ?? "00"}${zone}`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new RangeError(`Invalid date: ${value}`);
    }
    return date;
  }
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

/**
 * `di 24/11/2026`, in Belgian time. Also accepts a Postgres `date` (`"2026-11-24"`), which
 * stays that calendar day.
 */
export function formatDate(value: Date | string | number): string {
  const parts = dateParts.formatToParts(toDate(value, true));
  const weekday = part(parts, "weekday").replace(/\.$/, "");
  return `${weekday} ${part(parts, "day")}/${part(parts, "month")}/${part(parts, "year")}`;
}

/** `14:00`, in Belgian time (24 hour clock, midnight is `00:00`). Needs a moment, not a `time`. */
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
 * A Postgres `time` without time zone (`"14:00:00"`, `"14:00"`, `"14:00:00.5"`) as `14:00`.
 * It is a wall clock time in Belgium, so nothing is converted. Throws for anything else,
 * such as `"24:00"` or `"2:00"`.
 */
export function formatTimeOfDay(value: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) {
    throw new RangeError(`Invalid time of day: ${value}`);
  }
  return `${match[1]}:${match[2]}`;
}

/**
 * The calendar day in Belgium as `2026-11-24`. Use this to decide "today" or "tomorrow"
 * (design chapter 6), never the time zone of the server.
 */
export function brusselsDayKey(value: Date | string | number): string {
  const parts = dayKeyFormat.formatToParts(toDate(value, true));
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}
