import { afterEach, describe, expect, it, vi } from "vitest";

import { getCompanyName, getCompanyPhone } from "./company";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getCompanyName", () => {
  it("returns the configured name, trimmed", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", "  FrisAir Koeltechniek ");
    expect(getCompanyName()).toBe("FrisAir Koeltechniek");
  });

  it.each(["", "   "])("returns nothing for the empty value %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", value);
    expect(getCompanyName()).toBeUndefined();
  });

  it("returns nothing when the variable is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", undefined);
    expect(getCompanyName()).toBeUndefined();
  });
});

describe("getCompanyPhone", () => {
  it.each([
    ["014 00 00 00", "014 00 00 00"],
    ["  +32 14 00 00 00 ", "+32 14 00 00 00"],
    ["014/41.22.87", "014/41.22.87"],
    ["(014) 41-22-87", "(014) 41-22-87"],
  ])("returns the configured number %j, trimmed", (value, expected) => {
    vi.stubEnv("COMPANY_PHONE", value);
    expect(getCompanyPhone()).toBe(expected);
  });

  it.each(["", "   "])("returns nothing for the empty value %j", (value) => {
    vi.stubEnv("COMPANY_PHONE", value);
    expect(getCompanyPhone()).toBeUndefined();
  });

  it("returns nothing when the variable is not set", () => {
    vi.stubEnv("COMPANY_PHONE", undefined);
    expect(getCompanyPhone()).toBeUndefined();
  });

  it.each([
    "bel ons",
    "12345",
    "014 00 00 00; rm -rf",
    "tel:014000000",
    "<b>014 00 00 00</b>",
    "1".repeat(40),
  ])("returns nothing for the invalid value %j, so no wrong number is shown", (value) => {
    vi.stubEnv("COMPANY_PHONE", value);
    expect(getCompanyPhone()).toBeUndefined();
  });

  it("is not a public variable: it has no NEXT_PUBLIC_ prefix", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_PHONE", "014 00 00 00");
    expect(getCompanyPhone()).toBeUndefined();
  });
});
