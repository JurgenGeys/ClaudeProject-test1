import { describe, expect, it } from "vitest";

import { parsePickUpTaskForm } from "./pick-up-task";

const VERSION = "2026-11-25T18:44:00.123456Z";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("parsePickUpTaskForm", () => {
  it("reads the task number and the version, and nothing else", () => {
    const parsed = parsePickUpTaskForm(
      form({
        taskNumber: "1042",
        version: VERSION,
        // Whatever else somebody sends is never read.
        assigneeId: "someone-else",
        status: "completed",
        pickedUpAt: "2020-01-01T00:00:00Z",
        updatedBy: "x",
      }),
    );
    expect(parsed).toEqual({ ok: true, data: { number: 1042, version: VERSION } });
  });

  it.each([["", "0", "01042", "-5", "10 42", "1e3", "9999999999", "abc"]])(
    "refuses a task number that is not plain digits: %j",
    (...numbers) => {
      for (const taskNumber of numbers) {
        expect(parsePickUpTaskForm(form({ taskNumber, version: VERSION }))).toEqual({ ok: false });
      }
    },
  );

  it.each([
    "",
    "yesterday",
    "2026-11-25",
    "2026-11-25T18:44:00Z",
    "2026-02-30T18:44:00.123456Z",
    "2026-11-25T25:44:00.123456Z",
    "2026-11-25T18:44:00.123456+01:00",
  ])("refuses a version that the page never writes: %j", (version) => {
    expect(parsePickUpTaskForm(form({ taskNumber: "1042", version }))).toEqual({ ok: false });
  });

  it("refuses a form without number or version", () => {
    expect(parsePickUpTaskForm(form({ version: VERSION }))).toEqual({ ok: false });
    expect(parsePickUpTaskForm(form({ taskNumber: "1042" }))).toEqual({ ok: false });
    expect(parsePickUpTaskForm(new FormData())).toEqual({ ok: false });
  });
});
