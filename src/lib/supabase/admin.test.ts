import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle; stub it for unit tests.
vi.mock("server-only", () => ({}));

import { createSupabaseAdminClient } from "./admin";

describe("createSupabaseAdminClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to start without the secret key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => createSupabaseAdminClient()).toThrow(/SUPABASE_SECRET_KEY is not set/);
  });

  it("creates a client with only the URL and the secret key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    expect(createSupabaseAdminClient()).toBeDefined();
  });
});
