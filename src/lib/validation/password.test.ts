import { describe, expect, it } from "vitest";

import { passwordFormSchema } from "./password";
import { fieldErrors } from "./test-helpers";

describe("passwordFormSchema", () => {
  it("accepts a password of 8 characters that is repeated correctly", () => {
    expect(
      passwordFormSchema.safeParse({ password: "abcd1234", confirmPassword: "abcd1234" }).success,
    ).toBe(true);
  });

  it("does not trim: spaces are part of a password", () => {
    expect(
      passwordFormSchema.parse({ password: "  abcdef  ", confirmPassword: "  abcdef  " }),
    ).toEqual({ password: "  abcdef  ", confirmPassword: "  abcdef  " });
    expect(
      fieldErrors(passwordFormSchema, { password: "abcdefgh ", confirmPassword: "abcdefgh" }),
    ).toEqual({ confirmPassword: ["De twee wachtwoorden zijn niet gelijk."] });
  });

  it("refuses a password of 7 characters, with only that message", () => {
    expect(
      fieldErrors(passwordFormSchema, { password: "abcd123", confirmPassword: "abcd123" }),
    ).toEqual({ password: ["Je wachtwoord moet minstens 8 tekens hebben."] });
    expect(fieldErrors(passwordFormSchema, { password: "abcd123", confirmPassword: "x" })).toEqual({
      password: ["Je wachtwoord moet minstens 8 tekens hebben."],
    });
  });

  it("refuses an empty form", () => {
    expect(fieldErrors(passwordFormSchema, { password: "", confirmPassword: "" })).toEqual({
      password: ["Je wachtwoord moet minstens 8 tekens hebben."],
    });
  });

  it("refuses two passwords that differ", () => {
    expect(
      fieldErrors(passwordFormSchema, { password: "abcd1234", confirmPassword: "abcd1235" }),
    ).toEqual({ confirmPassword: ["De twee wachtwoorden zijn niet gelijk."] });
    expect(fieldErrors(passwordFormSchema, { password: "abcd1234", confirmPassword: "" })).toEqual({
      confirmPassword: ["De twee wachtwoorden zijn niet gelijk."],
    });
  });

  it("refuses more than 72 bytes, also when the characters are multi-byte", () => {
    const long = "a".repeat(73);
    expect(fieldErrors(passwordFormSchema, { password: long, confirmPassword: long })).toEqual({
      password: ["Je wachtwoord is te lang. Gebruik hoogstens 72 tekens."],
    });
    const accents = "é".repeat(37); // 74 bytes
    expect(
      fieldErrors(passwordFormSchema, { password: accents, confirmPassword: accents }),
    ).toEqual({ password: ["Je wachtwoord is te lang. Gebruik hoogstens 72 tekens."] });
    const exactly = "a".repeat(72);
    expect(
      passwordFormSchema.safeParse({ password: exactly, confirmPassword: exactly }).success,
    ).toBe(true);
  });

  it("treats missing fields as a problem, not a crash", () => {
    expect(fieldErrors(passwordFormSchema, {})).toMatchObject({
      password: ["Je wachtwoord moet minstens 8 tekens hebben."],
    });
  });
});
