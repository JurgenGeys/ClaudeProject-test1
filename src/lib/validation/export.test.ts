import { describe, expect, it } from "vitest";

import { daysInPeriod, exportPageHref, parseExportParams, parseExportProblem } from "./export";

describe("parseExportParams", () => {
  it("accepts a period and a scope", () => {
    expect(parseExportParams({ from: "2026-11-01", to: "2026-11-30", scope: "all" })).toEqual({
      ok: true,
      params: { from: "2026-11-01", to: "2026-11-30", scope: "all" },
    });
  });

  it("uses 'completed' when the scope is missing", () => {
    const result = parseExportParams({ from: "2026-11-01", to: "2026-11-30" });
    expect(result).toMatchObject({ ok: true, params: { scope: "completed" } });
  });

  it("accepts one single day", () => {
    expect(parseExportParams({ from: "2026-11-05", to: "2026-11-05" }).ok).toBe(true);
  });

  it.each([
    [{}],
    [{ from: "2026-11-01" }],
    [{ to: "2026-11-30" }],
    [{ from: "", to: "2026-11-30" }],
    [{ from: "2026-13-01", to: "2026-11-30" }],
    [{ from: "2026-02-30", to: "2026-11-30" }],
    [{ from: "1999-01-01", to: "2026-11-30" }],
    [{ from: "2026-11-01", to: "2101-01-01" }],
    [{ from: ["2026-11-01", "2026-10-01"], to: "2026-11-30" }],
    [{ from: "2026-11-01'; drop", to: "2026-11-30" }],
  ])("says 'missing' for %j", (raw) => {
    expect(parseExportParams(raw)).toMatchObject({ ok: false, problem: "missing" });
  });

  it("says 'reversed' when the end is before the start, and returns the days", () => {
    expect(parseExportParams({ from: "2026-11-30", to: "2026-11-01" })).toEqual({
      ok: false,
      problem: "reversed",
      from: "2026-11-30",
      to: "2026-11-01",
      scope: "completed",
    });
  });

  it("accepts exactly 366 days and refuses 367 (a year is the longest period)", () => {
    expect(parseExportParams({ from: "2028-01-01", to: "2028-12-31" }).ok).toBe(true); // 366 days
    expect(parseExportParams({ from: "2026-01-01", to: "2026-12-31" }).ok).toBe(true); // 365 days
    expect(parseExportParams({ from: "2026-01-01", to: "2027-01-02" })).toMatchObject({
      ok: false,
      problem: "toolong",
    });
    expect(parseExportParams({ from: "2028-01-01", to: "2029-01-01" })).toMatchObject({
      ok: false,
      problem: "toolong",
    });
  });

  it.each(["everything", "", "ALL", ["all", "completed"]])("says 'scope' for scope %j", (scope) => {
    expect(parseExportParams({ from: "2026-11-01", to: "2026-11-30", scope })).toMatchObject({
      ok: false,
      problem: "scope",
      scope: "completed",
    });
  });
});

describe("parseExportProblem", () => {
  it("only knows the listed problems", () => {
    expect(parseExportProblem("empty")).toBe("empty");
    expect(parseExportProblem("reversed")).toBe("reversed");
    expect(parseExportProblem("<script>")).toBeNull();
    expect(parseExportProblem(undefined)).toBeNull();
    expect(parseExportProblem(["empty", "empty"])).toBeNull();
  });
});

describe("exportPageHref", () => {
  it("always points to the export page, with only the given values", () => {
    expect(
      exportPageHref({ from: "2026-11-01", to: "2026-11-30", scope: "all", problem: "empty" }),
    ).toBe("/tasks/export?from=2026-11-01&to=2026-11-30&scope=all&problem=empty");
    expect(exportPageHref({ from: null, to: null, scope: "completed", problem: "missing" })).toBe(
      "/tasks/export?scope=completed&problem=missing",
    );
  });
});

describe("daysInPeriod", () => {
  it("counts both days, also over the clock change", () => {
    expect(daysInPeriod("2026-11-05", "2026-11-05")).toBe(1);
    expect(daysInPeriod("2033-03-26", "2033-03-28")).toBe(3);
    expect(daysInPeriod("2033-10-29", "2033-10-31")).toBe(3);
  });
});
