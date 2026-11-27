import { describe, expect, it } from "vitest";

import { previousMonth } from "./period";

describe("previousMonth", () => {
  it.each([
    ["2026-11-27", "2026-10-01", "2026-10-31"],
    ["2026-03-01", "2026-02-01", "2026-02-28"],
    ["2028-03-15", "2028-02-01", "2028-02-29"],
    ["2026-01-05", "2025-12-01", "2025-12-31"],
    ["2026-05-31", "2026-04-01", "2026-04-30"],
  ])("on %s it is %s to %s", (today, from, to) => {
    expect(previousMonth(today)).toEqual({ from, to });
  });

  it("refuses a wrong date", () => {
    expect(() => previousMonth("27/11/2026")).toThrow(RangeError);
  });
});
