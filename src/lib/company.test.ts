import { afterEach, describe, expect, it, vi } from "vitest";

import { getCompanyName } from "./company";

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
