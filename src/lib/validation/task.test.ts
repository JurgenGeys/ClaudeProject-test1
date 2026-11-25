import { describe, expect, it } from "vitest";

import { MAX_ESTIMATED_MINUTES } from "@/lib/tasks/limits";

import { fieldErrors } from "./test-helpers";
import { taskSchema } from "./task";

const valid = {
  customerId: "11111111-1111-4111-8111-111111111111",
  locationStreet: "Kerkstraat 12",
  locationPostalCode: "2310",
  locationCity: "Rijkevorsel",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud\nFilter vervangen",
  scheduledDate: "2026-11-25",
  startTime: "14:00",
};

describe("taskSchema", () => {
  it("accepts the required fields; duration and technician default to null", () => {
    expect(taskSchema.parse(valid)).toEqual({
      ...valid,
      estimatedMinutes: null,
      assigneeId: null,
    });
  });

  it("accepts every kind of work", () => {
    for (const workType of ["inspection", "maintenance", "repair"]) {
      expect(taskSchema.parse({ ...valid, workType }).workType).toBe(workType);
    }
  });

  it("requires the kind of work and refuses an unknown one", () => {
    for (const workType of [undefined, "", "installation", null]) {
      expect(fieldErrors(taskSchema, { ...valid, workType })).toEqual({
        workType: ["Kies het soort werk: nazicht, onderhoud of herstelling."],
      });
    }
  });

  it("gives the messages of design B2 for the other required fields", () => {
    expect(
      fieldErrors(taskSchema, {
        customerId: "",
        locationStreet: " ",
        locationPostalCode: "",
        locationCity: "",
        workType: "repair",
        instructions: "",
        scheduledDate: "",
        startTime: "",
      }),
    ).toEqual({
      customerId: ["Kies een klant of maak een nieuwe klant aan."],
      locationStreet: ["Vul de straat en het huisnummer in."],
      locationPostalCode: ["Vul een geldige postcode in (4 cijfers)."],
      locationCity: ["Vul de gemeente in."],
      instructions: ["Beschrijf wat de technieker moet doen."],
      scheduledDate: ["Kies een datum."],
      startTime: ["Kies een startuur."],
    });
  });

  it("requires a real calendar date", () => {
    for (const scheduledDate of ["2026-02-30", "2026-13-01", "25/11/2026", "2026-11-25T10:00"]) {
      expect(fieldErrors(taskSchema, { ...valid, scheduledDate })).toEqual({
        scheduledDate: ["Kies een datum."],
      });
    }
    // A date in the past is allowed (design B2: only a warning).
    expect(taskSchema.parse({ ...valid, scheduledDate: "2020-01-01" }).scheduledDate).toBe(
      "2020-01-01",
    );
  });

  it("requires a start time per quarter of an hour", () => {
    for (const startTime of ["14:10", "24:00", "9:00", "14:00:00", "14u00"]) {
      expect(fieldErrors(taskSchema, { ...valid, startTime })).toEqual({
        startTime: ["Kies een startuur."],
      });
    }
    for (const startTime of ["00:00", "07:45", "23:45"]) {
      expect(taskSchema.parse({ ...valid, startTime }).startTime).toBe(startTime);
    }
  });

  it("checks the postal code of the location", () => {
    for (const locationPostalCode of ["231", "23100", "abcd"]) {
      expect(fieldErrors(taskSchema, { ...valid, locationPostalCode })).toHaveProperty(
        "locationPostalCode",
      );
    }
  });

  describe("estimated duration", () => {
    it("is optional: missing, null and an empty field are all null", () => {
      for (const estimatedMinutes of [undefined, null, ""]) {
        expect(taskSchema.parse({ ...valid, estimatedMinutes }).estimatedMinutes).toBeNull();
      }
    });

    it("accepts quarters, as a number or as the text of a form", () => {
      expect(taskSchema.parse({ ...valid, estimatedMinutes: 90 }).estimatedMinutes).toBe(90);
      expect(taskSchema.parse({ ...valid, estimatedMinutes: "45" }).estimatedMinutes).toBe(45);
    });

    it("refuses 0, negative, no quarter and no number", () => {
      for (const estimatedMinutes of [0, -15, 20, 7.5, "abc", "0"]) {
        expect(fieldErrors(taskSchema, { ...valid, estimatedMinutes })).toBeTruthy();
      }
    });

    it("accepts at most 8u00 (decision K8)", () => {
      expect(MAX_ESTIMATED_MINUTES).toBe(8 * 60);
      expect(
        taskSchema.parse({ ...valid, estimatedMinutes: MAX_ESTIMATED_MINUTES }).estimatedMinutes,
      ).toBe(MAX_ESTIMATED_MINUTES);
      expect(
        fieldErrors(taskSchema, { ...valid, estimatedMinutes: MAX_ESTIMATED_MINUTES + 15 }),
      ).toEqual({ estimatedMinutes: ["De geschatte duur mag niet meer zijn dan 8u00."] });
    });
  });

  describe("technician", () => {
    it("is optional: missing, null and an empty choice are 'Nog niet toewijzen'", () => {
      for (const assigneeId of [undefined, null, ""]) {
        expect(taskSchema.parse({ ...valid, assigneeId }).assigneeId).toBeNull();
      }
    });

    it("accepts an id and refuses something that is not an id", () => {
      const assigneeId = "22222222-2222-4222-8222-222222222222";
      expect(taskSchema.parse({ ...valid, assigneeId }).assigneeId).toBe(assigneeId);
      expect(fieldErrors(taskSchema, { ...valid, assigneeId: "kevin" })).toEqual({
        assigneeId: ["Kies een technieker uit de lijst."],
      });
    });
  });

  it("does not accept a status or number from the form (they are ignored, not copied)", () => {
    const parsed = taskSchema.parse({ ...valid, status: "completed", number: 1, createdBy: "x" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("number");
    expect(parsed).not.toHaveProperty("createdBy");
  });
});
