import { describe, expect, it } from "vitest";

import { MAX_CORRECTED_MINUTES } from "@/lib/tasks/limits";

import { hoursCorrectionSchema } from "./hours-correction";
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

  it("only refuses absurd hours: the technical limit is not a product decision", () => {
    // TODO (Jurgen decides): the limit is a safety limit of 7 days for now.
    expect(MAX_CORRECTED_MINUTES).toBe(7 * 24 * 60);
    expect(
      hoursCorrectionSchema.parse({ correctedMinutes: MAX_CORRECTED_MINUTES, reason: "x" })
        .correctedMinutes,
    ).toBe(MAX_CORRECTED_MINUTES);
    expect(
      fieldErrors(hoursCorrectionSchema, {
        correctedMinutes: MAX_CORRECTED_MINUTES + 15,
        reason: "x",
      }),
    ).toHaveProperty("correctedMinutes");
  });

  it("refuses an absurdly long reason", () => {
    expect(
      fieldErrors(hoursCorrectionSchema, { correctedMinutes: 60, reason: "x".repeat(1001) }),
    ).toHaveProperty("reason");
  });
});
