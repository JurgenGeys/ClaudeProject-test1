import { describe, expect, it } from "vitest";

import {
  hasExtraFilters,
  isPeriodReversed,
  PAGE_SIZE,
  overviewTabs,
  parseTaskOverviewParams,
  taskOverviewHref,
} from "./task-overview";

const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";

describe("parseTaskOverviewParams", () => {
  it("has no filters and the tab Actief by default", () => {
    expect(parseTaskOverviewParams({})).toEqual({
      tab: "active",
      technician: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("reads every parameter", () => {
    expect(
      parseTaskOverviewParams({
        status: "picked_up",
        technician: ID,
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    ).toEqual({ tab: "picked_up", technician: ID, from: "2026-11-01", to: "2026-11-30", page: 1 });
  });

  it.each(overviewTabs)("accepts the tab '%s'", (tab) => {
    expect(parseTaskOverviewParams({ status: tab }).tab).toBe(tab);
  });

  it.each([
    ["an unknown status", { status: "done" }],
    ["a status in other case", { status: "OPEN" }],
    ["an empty status", { status: "" }],
    ["a status given twice", { status: ["open", "assigned"] }],
    ["an SQL-like status", { status: "open' or '1'='1" }],
  ])("falls back to Actief for %s", (_name, raw) => {
    expect(parseTaskOverviewParams(raw).tab).toBe("active");
  });

  it.each([
    ["not a uuid", "kevin"],
    ["a uuid with a character too many", `${ID}0`],
    ["empty", ""],
    ["a number", "12"],
    ["injection", `${ID}' or true --`],
  ])("ignores a technician that is %s", (_name, technician) => {
    expect(parseTaskOverviewParams({ technician }).technician).toBeNull();
  });

  it("ignores a technician given twice", () => {
    expect(parseTaskOverviewParams({ technician: [ID, ID] }).technician).toBeNull();
  });

  it.each([
    ["not a date", "morgen"],
    ["a day that does not exist", "2026-02-30"],
    ["a month that does not exist", "2026-13-01"],
    ["a European notation", "24/11/2026"],
    ["a date with a time", "2026-11-24T10:00:00Z"],
    ["a year before the supported range", "1999-12-31"],
    ["a year after the supported range", "2101-01-01"],
    ["year 0000", "0000-01-01"],
    ["empty", ""],
  ])("ignores a period date that is %s", (_name, value) => {
    expect(parseTaskOverviewParams({ from: value, to: value })).toMatchObject({
      from: null,
      to: null,
    });
  });

  it("accepts a leap day and the edges of the range", () => {
    expect(parseTaskOverviewParams({ from: "2028-02-29", to: "2100-12-31" })).toMatchObject({
      from: "2028-02-29",
      to: "2100-12-31",
    });
    expect(parseTaskOverviewParams({ from: "2000-01-01" }).from).toBe("2000-01-01");
  });

  it("keeps the valid parameters when another one is invalid", () => {
    expect(
      parseTaskOverviewParams({ status: "nonsense", technician: ID, from: "x", to: "2026-11-30" }),
    ).toEqual({ tab: "active", technician: ID, from: null, to: "2026-11-30", page: 1 });
  });

  it("ignores parameters it does not know", () => {
    expect(parseTaskOverviewParams({ saved: "1051", foo: "bar" })).toEqual({
      tab: "active",
      technician: null,
      from: null,
      to: null,
      page: 1,
    });
  });
});

describe("hasExtraFilters", () => {
  const none = { tab: "open", technician: null, from: null, to: null, page: 1 } as const;

  it("does not count the tab", () => {
    expect(hasExtraFilters(none)).toBe(false);
  });

  it.each([{ technician: ID }, { from: "2026-11-01" }, { to: "2026-11-30" }])(
    "counts %j",
    (extra) => {
      expect(hasExtraFilters({ ...none, ...extra })).toBe(true);
    },
  );
});

describe("taskOverviewHref", () => {
  it("is plain /tasks for the default view", () => {
    expect(taskOverviewHref({})).toBe("/tasks");
    expect(
      taskOverviewHref({ tab: "active", technician: null, from: null, to: null, page: 1 }),
    ).toBe("/tasks");
  });

  it("leaves out what is default and keeps the rest", () => {
    expect(taskOverviewHref({ tab: "cancelled" })).toBe("/tasks?status=cancelled");
    expect(taskOverviewHref({ technician: ID })).toBe(`/tasks?technician=${ID}`);
    expect(
      taskOverviewHref({
        tab: "all",
        technician: ID,
        from: "2026-11-01",
        to: "2026-11-30",
        page: 1,
      }),
    ).toBe(`/tasks?status=all&technician=${ID}&from=2026-11-01&to=2026-11-30`);
  });

  it("makes a URL that parses back to the same filters", () => {
    const filters = {
      tab: "invoiced",
      technician: ID,
      from: "2026-01-01",
      to: "2026-12-31",
      page: 1,
    } as const;
    const query = Object.fromEntries(new URL(taskOverviewHref(filters), "http://x").searchParams);
    expect(parseTaskOverviewParams(query)).toEqual(filters);
  });
});

describe("the page parameter", () => {
  it("is page 1 by default and reads a page number", () => {
    expect(parseTaskOverviewParams({}).page).toBe(1);
    expect(parseTaskOverviewParams({ page: "3" }).page).toBe(3);
    expect(parseTaskOverviewParams({ page: "999999" }).page).toBe(999999);
  });

  it.each(["0", "-1", "1.5", "1e3", "+2", " 2", "abc", "", "1000000", "007", "2; drop"])(
    "ignores %j",
    (page) => {
      expect(parseTaskOverviewParams({ page }).page).toBe(1);
    },
  );

  it("ignores a page given twice", () => {
    expect(parseTaskOverviewParams({ page: ["2", "3"] }).page).toBe(1);
  });

  it("is in the URL only from page 2", () => {
    expect(taskOverviewHref({ page: 1 })).toBe("/tasks");
    expect(taskOverviewHref({ tab: "all", technician: ID, page: 3 })).toBe(
      `/tasks?status=all&technician=${ID}&page=3`,
    );
  });

  it("has 50 tasks per page", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("isPeriodReversed", () => {
  it.each([
    [{ from: "2026-11-30", to: "2026-11-01" }, true],
    [{ from: "2026-11-01", to: "2026-11-30" }, false],
    [{ from: "2026-11-01", to: "2026-11-01" }, false],
    [{ from: "2026-11-01", to: null }, false],
    [{ from: null, to: "2026-11-01" }, false],
    [{ from: null, to: null }, false],
  ])("%j is %s", (period, expected) => {
    expect(isPeriodReversed(period)).toBe(expected);
  });
});
