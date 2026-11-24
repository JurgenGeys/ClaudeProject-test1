import { describe, expect, it } from "vitest";

import { loginSchema } from "./login";

describe("loginSchema", () => {
  it("accepts an e-mail address and a password and trims the address", () => {
    expect(loginSchema.parse({ email: "  kevin@frisair.be ", password: " geheim " })).toEqual({
      email: "kevin@frisair.be",
      password: " geheim ",
    });
  });

  it("asks for an e-mail address when it is empty or only spaces", () => {
    for (const email of ["", "   "]) {
      const result = loginSchema.safeParse({ email, password: "x" });
      expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([
        "Vul je e-mailadres in.",
      ]);
    }
  });

  it("asks for a password when it is empty", () => {
    const result = loginSchema.safeParse({ email: "kevin@frisair.be", password: "" });
    expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([
      "Vul je wachtwoord in.",
    ]);
  });

  it("limits the length of both fields", () => {
    expect(loginSchema.safeParse({ email: "a".repeat(321), password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a".repeat(320), password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.be", password: "x".repeat(1025) }).success).toBe(
      false,
    );
    expect(loginSchema.safeParse({ email: "a@b.be", password: "x".repeat(1024) }).success).toBe(
      true,
    );
  });

  it("does not judge the format of the address (that would reveal which addresses exist)", () => {
    expect(loginSchema.safeParse({ email: "geen-adres", password: "x" }).success).toBe(true);
  });
});
