import { describe, expect, it } from "vitest";

import { parseCompleteTaskForm } from "./complete-task";

const VERSION = "2026-11-25T18:44:00.123456Z";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}
const base = { taskNumber: "1042", version: VERSION, workedMinutes: "90", notes: "Klaar" };

describe("parseCompleteTaskForm", () => {
  it("reads the four known fields and nothing else", () => {
    expect(
      parseCompleteTaskForm(
        form({ ...base, assigneeId: "x", status: "invoiced", completedBy: "y" }),
      ),
    ).toEqual({
      ok: true,
      data: { number: 1042, version: VERSION, workedMinutes: 90, notes: "Klaar" },
    });
  });

  it("accepts the limits 0u15 and 16u00, and no notes", () => {
    for (const workedMinutes of ["15", "960"]) {
      const parsed = parseCompleteTaskForm(form({ ...base, workedMinutes, notes: "" }));
      expect(parsed).toMatchObject({
        ok: true,
        data: { workedMinutes: Number(workedMinutes), notes: null },
      });
    }
  });

  it.each(["", "0", "-15", "abc", "10", "961", "975", "1e3"])(
    "refuses worked minutes %j",
    (workedMinutes) => {
      const parsed = parseCompleteTaskForm(form({ ...base, workedMinutes }));
      expect(parsed).toMatchObject({ ok: false, kind: "fields" });
    },
  );

  it("reports hours and notes separately", () => {
    expect(
      parseCompleteTaskForm(form({ ...base, workedMinutes: "0", notes: "x".repeat(2001) })),
    ).toEqual({
      ok: false,
      kind: "fields",
      fieldErrors: {
        workedMinutes: "Vul de gewerkte uren in. Dat moet minstens 0u15 zijn.",
        notes: "Je notitie is te lang. Houd het korter dan 2000 tekens.",
      },
    });
  });

  it("counts 2000 characters as fine and 2001 as too long", () => {
    expect(parseCompleteTaskForm(form({ ...base, notes: "x".repeat(2000) })).ok).toBe(true);
    expect(parseCompleteTaskForm(form({ ...base, notes: "x".repeat(2001) })).ok).toBe(false);
  });

  it("refuses a missing hours field as 'no hours'", () => {
    const data = form(base);
    data.delete("workedMinutes");
    expect(parseCompleteTaskForm(data)).toMatchObject({ ok: false, kind: "fields" });
  });

  it("refuses a bad task number or version, or a file instead of text, as an invalid form", () => {
    expect(parseCompleteTaskForm(form({ ...base, taskNumber: "01042" }))).toEqual({
      ok: false,
      kind: "invalid-form",
    });
    expect(parseCompleteTaskForm(form({ ...base, version: "yesterday" }))).toEqual({
      ok: false,
      kind: "invalid-form",
    });
    const data = form(base);
    data.set("notes", new File(["x"], "x.txt"));
    expect(parseCompleteTaskForm(data)).toEqual({ ok: false, kind: "invalid-form" });
    expect(parseCompleteTaskForm(new FormData())).toEqual({ ok: false, kind: "invalid-form" });
  });
});
