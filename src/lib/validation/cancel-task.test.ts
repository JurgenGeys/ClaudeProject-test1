import { describe, expect, it } from "vitest";

import { parseCancelTaskForm } from "./cancel-task";

const valid = {
  taskNumber: "1043",
  version: "2026-11-25T18:44:00.123456Z",
  reason: "Klant heeft zelf afgezegd",
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

describe("parseCancelTaskForm", () => {
  it("accepts the number, the version and a reason", () => {
    expect(parseCancelTaskForm(form())).toEqual({
      ok: true,
      data: { number: 1043, version: valid.version, reason: "Klant heeft zelf afgezegd" },
    });
  });

  it.each([[""], ["   "], [null]])("does not require a reason (%j)", (reason) => {
    expect(parseCancelTaskForm(form({ reason }))).toEqual({
      ok: true,
      data: { number: 1043, version: valid.version, reason: null },
    });
  });

  it("trims the reason and gives it one kind of line break", () => {
    const result = parseCancelTaskForm(form({ reason: "  Klant belt terug.\r\nVoorjaar  " }));
    expect(result).toMatchObject({ ok: true, data: { reason: "Klant belt terug.\nVoorjaar" } });
  });

  it("accepts 500 characters and refuses 501 under the field", () => {
    expect(parseCancelTaskForm(form({ reason: "x".repeat(500) }))).toMatchObject({ ok: true });
    expect(parseCancelTaskForm(form({ reason: "x".repeat(501) }))).toEqual({
      ok: false,
      reason: "fields",
      fieldErrors: { reason: "De reden is te lang. Houd ze korter dan 500 tekens." },
    });
  });

  it.each([
    ["taskNumber", "abc"],
    ["taskNumber", "0"],
    ["taskNumber", null],
    ["version", ""],
    ["version", "yesterday"],
    ["version", null],
  ])("a form with a wrong %s (%j) is 'stale', whatever the reason says", (key, value) => {
    expect(parseCancelTaskForm(form({ [key]: value }))).toEqual({ ok: false, reason: "stale" });
  });

  it("reads nothing else: a status, a user or a time in the form is ignored", () => {
    const data = form();
    data.set("status", "completed");
    data.set("cancelledBy", "someone");
    data.set("cancelledAt", "2020-01-01");
    expect(parseCancelTaskForm(data)).toEqual({
      ok: true,
      data: { number: 1043, version: valid.version, reason: "Klant heeft zelf afgezegd" },
    });
  });

  it("ignores a file where text is expected", () => {
    const data = form();
    data.set("reason", new File(["x"], "x.txt"));
    expect(parseCancelTaskForm(data)).toMatchObject({ ok: true, data: { reason: null } });
  });
});
