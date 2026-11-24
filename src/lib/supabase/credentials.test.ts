import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseCredentialsClient } from "./credentials";

describe("createSupabaseCredentialsClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("needs the public Supabase settings", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(() => createSupabaseCredentialsClient()).toThrow(/Supabase is not configured/);
  });

  it("creates a client with the publishable key that stores nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_must_not_be_used");
    const client = createSupabaseCredentialsClient();
    expect(client).toBeDefined();
    // No persistence: nothing ends up in a cookie or in storage.
    expect(document.cookie).toBe("");
  });
});
