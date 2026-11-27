import { describe, expect, it } from "vitest";

import { exportPageHref, parseExportParams, parseExportProblem } from "./export";

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
