import { afterEach, describe, expect, it, vi } from "vitest";

import { getSupabasePublicEnv, getSupabaseUrl } from "./env";

describe("getSupabasePublicEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the public settings", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    expect(getSupabasePublicEnv()).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_test",
    });
  });

  it("names the missing variable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(() => getSupabasePublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => getSupabasePublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("reports unset variables too", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    expect(() => getSupabasePublicEnv()).toThrow(/PUBLISHABLE_KEY is not set/);
  });

  it("getSupabaseUrl needs only the URL and rejects an invalid one", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(getSupabaseUrl()).toBe("http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    expect(() => getSupabaseUrl()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
