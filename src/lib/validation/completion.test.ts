import { describe, expect, it } from "vitest";

import { completionSchema } from "./completion";
import { fieldErrors } from "./test-helpers";

describe("completionSchema", () => {
  it("accepts hours per quarter, from 0u15 to 16u00", () => {
    for (const workedMinutes of [15, 30, 90, 600, 960]) {
      expect(completionSchema.parse({ workedMinutes, notes: "" }).workedMinutes).toBe(
        workedMinutes,
      );
    }
  });

  it("reads the text of a form field", () => {
    expect(completionSchema.parse({ workedMinutes: "90" }).workedMinutes).toBe(90);
  });

  it("asks for hours when missing, empty, 0 or negative", () => {
    for (const workedMinutes of [undefined, null, "", "  ", 0, "0", -15, Number.NaN, "abc"]) {
      expect(fieldErrors(completionSchema, { workedMinutes })).toEqual({
        workedMinutes: ["Vul de gewerkte uren in. Dat moet minstens 0u15 zijn."],
      });
    }
  });

  it("refuses hours that are no whole quarters", () => {
    for (const workedMinutes of [20, 100, 7.5, 959]) {
      expect(fieldErrors(completionSchema, { workedMinutes })).toEqual({
        workedMinutes: ["Vul de gewerkte uren in per kwartier, bv. 1u30."],
      });
    }
  });

  it("refuses more than 16u00", () => {
    expect(fieldErrors(completionSchema, { workedMinutes: 975 })).toEqual({
      workedMinutes: ["De gewerkte uren mogen niet meer zijn dan 16u00."],
    });
    expect(
      fieldErrors(completionSchema, { workedMinutes: Number.POSITIVE_INFINITY }),
    ).toHaveProperty("workedMinutes");
  });

  it("notes are optional and trimmed; empty becomes null", () => {
    expect(completionSchema.parse({ workedMinutes: 60 }).notes).toBeNull();
    expect(completionSchema.parse({ workedMinutes: 60, notes: "   " }).notes).toBeNull();
    expect(completionSchema.parse({ workedMinutes: 60, notes: " Filter vervangen " }).notes).toBe(
      "Filter vervangen",
    );
  });

  it("limits the notes to 2000 characters", () => {
    expect(fieldErrors(completionSchema, { workedMinutes: 60, notes: "x".repeat(2001) })).toEqual({
      notes: ["Je notitie is te lang. Houd het korter dan 2000 tekens."],
    });
    expect(
      completionSchema.parse({ workedMinutes: 60, notes: "x".repeat(2000) }).notes,
    ).toHaveLength(2000);
  });
});
