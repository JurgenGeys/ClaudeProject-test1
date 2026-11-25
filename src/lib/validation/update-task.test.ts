import { describe, expect, it } from "vitest";

import { parseUpdateTask, readUpdateTaskForm, UPDATE_TASK_FIELDS } from "./update-task";

const valid = {
  customerMode: "existing",
  customerId: "11111111-1111-4111-8111-111111111111",
  locationStreet: "Kerkstraat 12",
  locationPostalCode: "2310",
  locationCity: "Rijkevorsel",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud",
  scheduledDate: "2026-12-01",
  startTime: "14:00",
  taskNumber: "1043",
  version: "2026-11-25 18:44:00.123456+00",
};

function raw(overrides: Record<string, string> = {}) {
  return readUpdateTaskForm(
    Object.entries({ ...valid, ...overrides }).reduce((data, [key, value]) => {
      data.set(key, value);
      return data;
    }, new FormData()),
  );
}

describe("readUpdateTaskForm", () => {
  it("reads the known fields as text and ignores the rest", () => {
    const data = new FormData();
    data.set("taskNumber", "1043");
    data.set("status", "completed");
    const result = readUpdateTaskForm(data);
    expect(Object.keys(result).sort()).toEqual([...UPDATE_TASK_FIELDS].sort());
    expect(result.taskNumber).toBe("1043");
    expect(result.version).toBe("");
    expect("status" in result).toBe(false);
  });
});

describe("parseUpdateTask", () => {
  it("accepts a valid form and returns the number and the version", () => {
    const result = parseUpdateTask(raw());
    expect(result).toMatchObject({
      ok: true,
      data: {
        number: 1043,
        version: "2026-11-25 18:44:00.123456+00",
        customer: { kind: "existing", id: valid.customerId },
        assigneeId: null,
        workType: "maintenance",
      },
    });
  });

  it.each([
    ["2026-11-25 18:44:00+00"],
    ["2026-11-25T18:44:00.5Z"],
    ["2026-11-25 19:44:00.123456+01:00"],
    ["2026-11-25 19:44:00.123456+0100"],
  ])("accepts the version %j", (version) => {
    expect(parseUpdateTask(raw({ version })).ok).toBe(true);
  });

  it.each([
    ["taskNumber", ""],
    ["taskNumber", "abc"],
    ["taskNumber", "0"],
    ["taskNumber", "1043; drop table tasks"],
    ["version", ""],
    ["version", "yesterday"],
    ["version", "2026-13-25 18:44:00+00"],
    ["version", "2026-02-30 18:44:00+00"],
    ["version", "2026-11-25 25:44:00+00"],
    ["version", "2026-11-25 18:44:00"],
    ["version", "2026-11-25 18:44:00+00'; --"],
  ])("answers 'stale' for a wrong %s (%j)", (field, value) => {
    expect(parseUpdateTask(raw({ [field]: value }))).toEqual({ ok: false, reason: "stale" });
  });

  it("reports the field errors of the task like the create form does", () => {
    const result = parseUpdateTask(raw({ locationStreet: "", workType: "" }));
    expect(result).toEqual({
      ok: false,
      reason: "fields",
      fieldErrors: {
        locationStreet: "Vul de straat en het huisnummer in.",
        workType: "Kies het soort werk: nazicht, onderhoud of herstelling.",
      },
    });
  });

  it("checks a new customer too", () => {
    const result = parseUpdateTask(
      raw({ customerMode: "new", customerId: "", newCustomerName: "" }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "fields",
      fieldErrors: { newCustomerName: "Vul de naam van de klant in." },
    });
  });
});
