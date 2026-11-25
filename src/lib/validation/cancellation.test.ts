import { describe, expect, it } from "vitest";

import { cancellationSchema } from "./cancellation";
import { fieldErrors } from "./test-helpers";

describe("cancellationSchema", () => {
  it("does not require a reason", () => {
    for (const input of [{}, { reason: "" }, { reason: "   " }, { reason: null }]) {
      expect(cancellationSchema.parse(input)).toEqual({ reason: null });
    }
  });

  it("keeps a reason, trimmed", () => {
    expect(cancellationSchema.parse({ reason: " klant heeft zelf afgezegd " })).toEqual({
      reason: "klant heeft zelf afgezegd",
    });
  });

  it("limits the reason to 500 characters", () => {
    expect(cancellationSchema.parse({ reason: "x".repeat(500) }).reason).toHaveLength(500);
    expect(fieldErrors(cancellationSchema, { reason: "x".repeat(501) })).toEqual({
      reason: ["De reden is te lang. Houd ze korter dan 500 tekens."],
    });
  });
});
