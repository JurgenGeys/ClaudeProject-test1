import { describe, expect, it } from "vitest";

import { parseResetTaskForm } from "./reset-task";

const KEVIN = "22222222-2222-4222-8222-222222222222";
const valid = {
  taskNumber: "1043",
  version: "2026-11-25T18:44:00.123456Z",
  assigneeId: KEVIN,
  scheduledDate: "2026-12-01",
  startTime: "08:00",
};

function form(overrides: Record<string, string | null> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...valid, ...overrides })) {
    if (value !== null) {
      data.set(key, value);
    }
  }
  return data;
}

describe("parseResetTaskForm", () => {
  it("accepts the number, version, technician, date and start time", () => {
    expect(parseResetTaskForm(form())).toEqual({
      ok: true,
      data: {
        number: 1043,
        version: valid.version,
        assigneeId: KEVIN,
        scheduledDate: "2026-12-01",
        startTime: "08:00",
      },
    });
  });

  it("reads nothing else: a status, a pick-up time or an actor in the form is ignored", () => {
    const data = form();
    data.set("status", "completed");
    data.set("pickedUpAt", "2026-11-25T08:00:00Z");
    data.set("updatedBy", KEVIN);
    const result = parseResetTaskForm(data);
    expect(result.ok && Object.keys(result.data).sort()).toEqual(
      ["assigneeId", "number", "scheduledDate", "startTime", "version"].sort(),
    );
  });

  it.each([
    ["no task number", { taskNumber: null }],
    ["a task number with a leading zero", { taskNumber: "01043" }],
    ["a task number that is text", { taskNumber: "abc" }],
    ["no version", { version: null }],
    ["a version in another format", { version: "2026-11-25 18:44:00" }],
  ])("answers %s as a form that this page did not make (stale)", (_name, overrides) => {
    expect(parseResetTaskForm(form(overrides))).toEqual({ ok: false, reason: "stale" });
  });

  it("asks for a technician: there is no 'Nog niet toewijzen' when resetting", () => {
    expect(parseResetTaskForm(form({ assigneeId: "" }))).toEqual({
      ok: false,
      reason: "fields",
      fieldErrors: { assigneeId: "Kies een technieker uit de lijst." },
    });
  });

  it("refuses a technician that is not an id", () => {
    const result = parseResetTaskForm(form({ assigneeId: "kevin" }));
    expect(result).toMatchObject({ ok: false, reason: "fields" });
  });

  it("gives a message per field", () => {
    expect(parseResetTaskForm(form({ scheduledDate: "2026-02-30", startTime: "08:10" }))).toEqual({
      ok: false,
      reason: "fields",
      fieldErrors: { scheduledDate: "Kies een datum.", startTime: "Kies een startuur." },
    });
  });

  it("refuses a missing date and start time", () => {
    expect(parseResetTaskForm(form({ scheduledDate: null, startTime: null }))).toMatchObject({
      ok: false,
      reason: "fields",
      fieldErrors: { scheduledDate: "Kies een datum.", startTime: "Kies een startuur." },
    });
  });
});
