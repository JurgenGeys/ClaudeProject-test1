import { describe, expect, it } from "vitest";

import {
  TASK_STATUS_LABELS,
  WORK_TYPE_LABELS,
  formatTaskNumber,
  taskStatusLabel,
  workTypeLabel,
} from "./labels";
import { taskStatuses, workTypes } from "./types";

describe("status labels", () => {
  it("has the Dutch label of the design for each of the six statuses", () => {
    expect(taskStatuses.map(taskStatusLabel)).toEqual([
      "Open",
      "Toegewezen",
      "Opgepikt",
      "Afgewerkt",
      "Gefactureerd",
      "Geannuleerd",
    ]);
  });

  it("has a label for every status and nothing more", () => {
    expect(Object.keys(TASK_STATUS_LABELS).sort()).toEqual([...taskStatuses].sort());
  });

  it("uses the database values of design chapter 5", () => {
    expect(taskStatuses).toEqual([
      "open",
      "assigned",
      "picked_up",
      "completed",
      "invoiced",
      "cancelled",
    ]);
  });
});

describe("work type labels", () => {
  it("has the Dutch label of the design for each work type", () => {
    expect(workTypes.map(workTypeLabel)).toEqual(["Nazicht", "Onderhoud", "Herstelling"]);
  });

  it("has a label for every work type and nothing more", () => {
    expect(Object.keys(WORK_TYPE_LABELS).sort()).toEqual([...workTypes].sort());
  });

  it("uses the database values of design chapter 5", () => {
    expect(workTypes).toEqual(["inspection", "maintenance", "repair"]);
  });
});

describe("formatTaskNumber", () => {
  it("puts a hash in front of the number", () => {
    expect(formatTaskNumber(1042)).toBe("#1042");
    expect(formatTaskNumber(1001)).toBe("#1001");
    expect(formatTaskNumber(12345)).toBe("#12345");
  });

  it("does not add grouping separators", () => {
    expect(formatTaskNumber(1000000)).toBe("#1000000");
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (value) => {
    expect(() => formatTaskNumber(value)).toThrow(RangeError);
  });
});
