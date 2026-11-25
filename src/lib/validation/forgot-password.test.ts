import { describe, expect, it } from "vitest";

import { forgotPasswordSchema } from "./forgot-password";

const messageOf = (email: unknown) => {
  const result = forgotPasswordSchema.safeParse({ email });
  return result.success ? null : result.error.issues[0].message;
};

describe("forgotPasswordSchema", () => {
  it("trims and lower-cases the address", () => {
    expect(forgotPasswordSchema.parse({ email: "  Sofie@Frisair.BE " })).toEqual({
      email: "sofie@frisair.be",
    });
  });

  it.each([[""], ["   "], [undefined], [null]])("asks for an address when it is %j", (email) => {
    expect(messageOf(email)).toBe("Vul je e-mailadres in.");
  });

  it.each([["geen-adres"], ["a@b"], ["a b@c.be"], ["@c.be"], [`${"a".repeat(400)}@c.be`]])(
    "refuses %j as not valid",
    (email) => {
      expect(messageOf(email)).toBe("Vul een geldig e-mailadres in.");
    },
  );
});
