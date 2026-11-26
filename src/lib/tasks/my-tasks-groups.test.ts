import { describe, expect, it } from "vitest";

import { addDays, groupMyTasks, relativeDay } from "./my-tasks-groups";
import type { TaskStatus } from "./types";

// Monday 23/11/2026, 10:00 in Belgium.
const NOW = new Date("2026-11-23T09:00:00Z");

const task = (id: string, scheduledDate: string, status: TaskStatus = "assigned") => ({
  id,
  scheduledDate,
  status,
});

describe("addDays", () => {
  it("counts on the calendar, over month, year and leap day", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-23", 0)).toBe("2026-11-23");
  });

  it("refuses a value that is not a day", () => {
    expect(() => addDays("23/11/2026", 1)).toThrow(RangeError);
  });
});

describe("relativeDay", () => {
  it("knows today and tomorrow in Belgian time", () => {
    expect(relativeDay("2026-11-23", NOW)).toBe("today");
    expect(relativeDay("2026-11-24", NOW)).toBe("tomorrow");
    expect(relativeDay("2026-11-25", NOW)).toBeNull();
    expect(relativeDay("2026-11-22", NOW)).toBeNull();
  });

  it("uses the Belgian day, not the day of the server (UTC)", () => {
    // 23:30 UTC on Sunday 22/11 is 00:30 on Monday 23/11 in Belgium.
    const justAfterMidnight = new Date("2026-11-22T23:30:00Z");
    expect(relativeDay("2026-11-23", justAfterMidnight)).toBe("today");
    expect(relativeDay("2026-11-24", justAfterMidnight)).toBe("tomorrow");
    // 22:30 UTC on Monday in summer time (UTC+2) is already Tuesday in Belgium.
    const summer = new Date("2026-07-06T22:30:00Z");
    expect(relativeDay("2026-07-07", summer)).toBe("today");
  });
});

describe("groupMyTasks", () => {
  it("puts picked up tasks in Bezig, whatever their day, and keeps their order", () => {
    const groups = groupMyTasks(
      [
        task("past-busy", "2026-11-20", "picked_up"),
        task("today-busy", "2026-11-23", "picked_up"),
        task("future-busy", "2026-11-30", "picked_up"),
      ],
      NOW,
    );
    expect(groups.busy.map((t) => t.id)).toEqual(["past-busy", "today-busy", "future-busy"]);
    expect(groups.late).toEqual([]);
    expect(groups.days).toEqual([]);
  });

  it("calls an assigned task of a day before today late, but not one of today", () => {
    const groups = groupMyTasks(
      [task("old", "2026-11-20"), task("yesterday", "2026-11-22"), task("today", "2026-11-23")],
      NOW,
    );
    expect(groups.late.map((t) => t.id)).toEqual(["old", "yesterday"]);
    expect(groups.days.map((d) => d.tasks.map((t) => t.id))).toEqual([["today"]]);
  });

  it("groups per day with today and tomorrow marked, in the given order", () => {
    const groups = groupMyTasks(
      [
        task("a", "2026-11-23"),
        task("b", "2026-11-23"),
        task("c", "2026-11-24"),
        task("d", "2026-11-25"),
        task("e", "2026-12-01"),
      ],
      NOW,
    );
    expect(groups.days.map((d) => [d.dayKey, d.relative, d.tasks.map((t) => t.id)])).toEqual([
      ["2026-11-23", "today", ["a", "b"]],
      ["2026-11-24", "tomorrow", ["c"]],
      ["2026-11-25", null, ["d"]],
      ["2026-12-01", null, ["e"]],
    ]);
  });

  it("splits the three kinds in one list", () => {
    const groups = groupMyTasks(
      [
        task("late", "2026-11-20"),
        task("busy", "2026-11-21", "picked_up"),
        task("today", "2026-11-23"),
      ],
      NOW,
    );
    expect(groups.busy.map((t) => t.id)).toEqual(["busy"]);
    expect(groups.late.map((t) => t.id)).toEqual(["late"]);
    expect(groups.days).toHaveLength(1);
  });

  it("leaves out tasks that do not belong in 'Te doen'", () => {
    const groups = groupMyTasks(
      [
        task("open", "2026-11-23", "open"),
        task("done", "2026-11-23", "completed"),
        task("invoiced", "2026-11-23", "invoiced"),
        task("cancelled", "2026-11-23", "cancelled"),
      ],
      NOW,
    );
    expect(groups).toEqual({ busy: [], late: [], days: [] });
  });

  it("returns empty groups for no tasks", () => {
    expect(groupMyTasks([], NOW)).toEqual({ busy: [], late: [], days: [] });
  });
});
