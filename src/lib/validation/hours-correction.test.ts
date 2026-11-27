import { describe, expect, it } from "vitest";

import { MAX_CORRECTED_MINUTES } from "@/lib/tasks/limits";

import { hoursCorrectionSchema, parseCorrectHoursForm } from "./hours-correction";
import { fieldErrors } from "./test-helpers";

describe("hoursCorrectionSchema", () => {
  it("accepts new hours per quarter with a reason", () => {
    expect(
      hoursCorrectionSchema.parse({ correctedMinutes: "90", reason: " Pauze niet afgetrokken " }),
    ).toEqual({ correctedMinutes: 90, reason: "Pauze niet afgetrokken" });
  });

  it("requires a reason: missing, empty and blank are refused", () => {
    for (const reason of [undefined, "", "   ", "\n"]) {
      expect(fieldErrors(hoursCorrectionSchema, { correctedMinutes: 90, reason })).toEqual({
        reason: ["Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'."],
      });
    }
  });

  it("asks for new hours when missing, 0 or negative, and wants whole quarters", () => {
    for (const correctedMinutes of [undefined, "", 0, -15]) {
      expect(fieldErrors(hoursCorrectionSchema, { correctedMinutes, reason: "x" })).toEqual({
        correctedMinutes: ["Vul de nieuwe uren in. Dat moet minstens 0u15 zijn."],
      });
    }
    for (const correctedMinutes of [10, 100, 7.5]) {
      expect(fieldErrors(hoursCorrectionSchema, { correctedMinutes, reason: "x" })).toEqual({
        correctedMinutes: ["Vul de nieuwe uren in per kwartier, bv. 1u30."],
      });
    }
  });

  it("accepts at most 16u00 (decision K8)", () => {
    expect(MAX_CORRECTED_MINUTES).toBe(16 * 60);
    expect(
      hoursCorrectionSchema.parse({ correctedMinutes: MAX_CORRECTED_MINUTES, reason: "x" })
        .correctedMinutes,
    ).toBe(MAX_CORRECTED_MINUTES);
    expect(
      fieldErrors(hoursCorrectionSchema, {
        correctedMinutes: MAX_CORRECTED_MINUTES + 15,
        reason: "x",
      }),
    ).toEqual({ correctedMinutes: ["De nieuwe uren mogen niet meer zijn dan 16u00."] });
  });

  it("accepts a reason of at most 500 characters (decision K8)", () => {
    expect(
      hoursCorrectionSchema.parse({ correctedMinutes: 60, reason: "x".repeat(500) }).reason,
    ).toHaveLength(500);
    expect(
      fieldErrors(hoursCorrectionSchema, { correctedMinutes: 60, reason: "x".repeat(501) }),
    ).toEqual({ reason: ["De reden is te lang. Houd ze korter dan 500 tekens."] });
  });
});

describe("parseCorrectHoursForm", () => {
  const VERSION = "2026-11-25T18:44:00.123456Z";
  function form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) {
      data.set(key, value);
    }
    return data;
  }
  const valid = { taskNumber: "1043", version: VERSION, correctedMinutes: "90", reason: " Pauze " };

  it("reads the number, version, hours and trimmed reason, and nothing else", () => {
    expect(parseCorrectHoursForm(form({ ...valid, status: "invoiced", updatedBy: "x" }))).toEqual({
      ok: true,
      data: { number: 1043, version: VERSION, correctedMinutes: 90, reason: "Pauze" },
    });
  });

  it.each([
    ["taskNumber", "abc"],
    ["taskNumber", "0"],
    ["version", ""],
    ["version", "yesterday"],
  ])("a wrong %s (%j) is a stale form", (key, value) => {
    expect(parseCorrectHoursForm(form({ ...valid, [key]: value }))).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("returns one message per field with the rules of the schema", () => {
    expect(parseCorrectHoursForm(form({ ...valid, correctedMinutes: "", reason: "  " }))).toEqual({
      ok: false,
      reason: "fields",
      fieldErrors: {
        correctedMinutes: "Vul de nieuwe uren in. Dat moet minstens 0u15 zijn.",
        reason: "Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'.",
      },
    });
    expect(parseCorrectHoursForm(form({ ...valid, correctedMinutes: "100" }))).toMatchObject({
      fieldErrors: { correctedMinutes: "Vul de nieuwe uren in per kwartier, bv. 1u30." },
    });
    expect(parseCorrectHoursForm(form({ ...valid, correctedMinutes: "975" }))).toMatchObject({
      fieldErrors: { correctedMinutes: "De nieuwe uren mogen niet meer zijn dan 16u00." },
    });
  });

  it("treats missing fields as empty", () => {
    expect(parseCorrectHoursForm(form({ taskNumber: "1043", version: VERSION }))).toMatchObject({
      ok: false,
      reason: "fields",
    });
  });
});
