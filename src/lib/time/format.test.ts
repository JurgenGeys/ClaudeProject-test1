import { describe, expect, it } from "vitest";

import {
  brusselsDayKey,
  formatDate,
  formatDateTime,
  formatHours,
  formatHoursDecimal,
  formatTime,
  hoursToMinutes,
  isQuarterHourMinutes,
  minutesToHours,
} from "./format";

describe("formatHours", () => {
  it.each([
    [0, "0u00"],
    [15, "0u15"],
    [30, "0u30"],
    [45, "0u45"],
    [60, "1u00"],
    [75, "1u15"],
    [90, "1u30"],
    [150, "2u30"],
    [390, "6u30"],
    [600, "10u00"],
    [6000, "100u00"],
  ])("shows %i minutes as %s", (minutes, expected) => {
    expect(formatHours(minutes)).toBe(expected);
  });

  it("also shows minutes that are not a quarter, so wrong data stays visible", () => {
    expect(formatHours(5)).toBe("0u05");
    expect(formatHours(61)).toBe("1u01");
  });

  it.each([-15, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (value) => {
    expect(() => formatHours(value)).toThrow(RangeError);
  });
});

describe("formatHoursDecimal", () => {
  it.each([
    [0, "0"],
    [15, "0,25"],
    [30, "0,5"],
    [45, "0,75"],
    [60, "1"],
    [90, "1,5"],
    [105, "1,75"],
    [600, "10"],
    [6000, "100"],
    [60000, "1000"],
  ])("exports %i minutes as %s (decimal comma, no thousands separator)", (minutes, expected) => {
    expect(formatHoursDecimal(minutes)).toBe(expected);
  });

  it.each([-15, 0.5, Number.NaN])("refuses %s", (value) => {
    expect(() => formatHoursDecimal(value)).toThrow(RangeError);
  });
});

describe("minutes and hours", () => {
  it("converts minutes to hours", () => {
    expect(minutesToHours(0)).toBe(0);
    expect(minutesToHours(15)).toBe(0.25);
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(600)).toBe(10);
  });

  it("converts hours to minutes per quarter", () => {
    expect(hoursToMinutes(0)).toBe(0);
    expect(hoursToMinutes(0.25)).toBe(15);
    expect(hoursToMinutes(1.5)).toBe(90);
    expect(hoursToMinutes(10)).toBe(600);
  });

  it("is the same both ways for every quarter up to 24 hours", () => {
    for (let minutes = 0; minutes <= 24 * 60; minutes += 15) {
      expect(hoursToMinutes(minutesToHours(minutes))).toBe(minutes);
    }
  });

  it.each([1.1, 0.1, 0.3333, -0.25, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s hours: not a whole number of quarters",
    (value) => {
      expect(() => hoursToMinutes(value)).toThrow(RangeError);
    },
  );

  it("refuses minutes it cannot convert", () => {
    expect(() => minutesToHours(-1)).toThrow(RangeError);
    expect(() => minutesToHours(0.5)).toThrow(RangeError);
  });
});

describe("isQuarterHourMinutes", () => {
  it.each([15, 30, 45, 60, 90, 600])("accepts %i", (value) => {
    expect(isQuarterHourMinutes(value)).toBe(true);
  });

  it.each([0, -15, 10, 20, 1.5, 7.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s",
    (value) => {
      expect(isQuarterHourMinutes(value)).toBe(false);
    },
  );
});

describe("dates and times in Belgian time", () => {
  it("formats a date with the abbreviated weekday", () => {
    expect(formatDate("2026-11-24T10:00:00Z")).toBe("di 24/11/2026");
    expect(formatDate("2026-03-02T12:00:00Z")).toBe("ma 02/03/2026");
    expect(formatDate("2026-03-08T12:00:00Z")).toBe("zo 08/03/2026");
  });

  it("formats a time on a 24 hour clock", () => {
    expect(formatTime("2026-11-24T13:00:00Z")).toBe("14:00");
    expect(formatTime("2026-11-24T13:05:00Z")).toBe("14:05");
    expect(formatTime("2026-11-24T21:45:00Z")).toBe("22:45");
  });

  it("combines date and time", () => {
    expect(formatDateTime("2026-11-24T13:00:00Z")).toBe("di 24/11/2026 14:00");
  });

  it("accepts a Date and a timestamp as well as a string", () => {
    const iso = "2026-11-24T13:00:00Z";
    expect(formatTime(new Date(iso))).toBe("14:00");
    expect(formatTime(Date.parse(iso))).toBe("14:00");
  });

  it("shows midnight as 00:00 (not 24:00) and uses the Belgian day", () => {
    // 23:00 UTC in winter is 00:00 in Belgium, already the next day.
    expect(formatTime("2026-11-24T23:00:00Z")).toBe("00:00");
    expect(formatDate("2026-11-24T23:00:00Z")).toBe("wo 25/11/2026");
    expect(formatTime("2026-11-24T22:59:00Z")).toBe("23:59");
    expect(formatDate("2026-11-24T22:59:00Z")).toBe("di 24/11/2026");
  });

  it("uses winter time (UTC+1) and summer time (UTC+2)", () => {
    expect(formatTime("2026-01-15T12:00:00Z")).toBe("13:00");
    expect(formatTime("2026-07-15T12:00:00Z")).toBe("14:00");
  });

  describe("change to summer time (Sunday 29 March 2026, 02:00 becomes 03:00)", () => {
    it("shows the hour before the change in winter time", () => {
      expect(formatDateTime("2026-03-29T00:59:00Z")).toBe("zo 29/03/2026 01:59");
    });

    it("skips the hour 02:00 to 03:00", () => {
      expect(formatDateTime("2026-03-29T01:00:00Z")).toBe("zo 29/03/2026 03:00");
    });

    it("moves midnight by one hour in UTC", () => {
      // 28 March 23:00 UTC = 29 March 00:00 (winter); 29 March 22:00 UTC = 30 March 00:00 (summer).
      expect(formatDateTime("2026-03-28T23:00:00Z")).toBe("zo 29/03/2026 00:00");
      expect(formatDateTime("2026-03-29T22:00:00Z")).toBe("ma 30/03/2026 00:00");
      expect(formatDateTime("2026-03-29T21:59:00Z")).toBe("zo 29/03/2026 23:59");
    });
  });

  describe("change to winter time (Sunday 25 October 2026, 03:00 becomes 02:00)", () => {
    it("shows the hour 02:00 twice, in summer time and in winter time", () => {
      expect(formatDateTime("2026-10-25T00:30:00Z")).toBe("zo 25/10/2026 02:30");
      expect(formatDateTime("2026-10-25T01:30:00Z")).toBe("zo 25/10/2026 02:30");
      expect(formatDateTime("2026-10-25T02:00:00Z")).toBe("zo 25/10/2026 03:00");
    });

    it("moves midnight by one hour in UTC", () => {
      // 24 October 22:00 UTC = 25 October 00:00 (summer); 25 October 23:00 UTC = 26 October 00:00 (winter).
      expect(formatDateTime("2026-10-24T22:00:00Z")).toBe("zo 25/10/2026 00:00");
      expect(formatDateTime("2026-10-25T23:00:00Z")).toBe("ma 26/10/2026 00:00");
    });
  });

  it.each(["", "not a date", "2026-13-45", Number.NaN])("refuses the invalid date %s", (value) => {
    expect(() => formatDate(value)).toThrow(RangeError);
    expect(() => formatTime(value)).toThrow(RangeError);
    expect(() => brusselsDayKey(value)).toThrow(RangeError);
  });
});

describe("brusselsDayKey", () => {
  it("gives the calendar day in Belgium, not in UTC", () => {
    expect(brusselsDayKey("2026-11-24T10:00:00Z")).toBe("2026-11-24");
    expect(brusselsDayKey("2026-11-24T22:59:00Z")).toBe("2026-11-24");
    expect(brusselsDayKey("2026-11-24T23:00:00Z")).toBe("2026-11-25");
    expect(brusselsDayKey("2026-07-14T21:59:00Z")).toBe("2026-07-14");
    expect(brusselsDayKey("2026-07-14T22:00:00Z")).toBe("2026-07-15");
  });

  it("is right on the days the clock changes", () => {
    expect(brusselsDayKey("2026-03-28T23:00:00Z")).toBe("2026-03-29");
    expect(brusselsDayKey("2026-03-29T21:59:00Z")).toBe("2026-03-29");
    expect(brusselsDayKey("2026-03-29T22:00:00Z")).toBe("2026-03-30");
    expect(brusselsDayKey("2026-10-24T22:00:00Z")).toBe("2026-10-25");
    expect(brusselsDayKey("2026-10-25T22:59:00Z")).toBe("2026-10-25");
    expect(brusselsDayKey("2026-10-25T23:00:00Z")).toBe("2026-10-26");
  });
});
