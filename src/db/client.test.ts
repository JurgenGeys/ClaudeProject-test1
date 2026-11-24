import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws when imported outside a server bundle; stub it for unit tests.
vi.mock("server-only", () => ({}));

describe("getDb", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("can be imported without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    await expect(import("./client")).resolves.toBeDefined();
  });

  it("throws a clear error on use when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await import("./client");
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });

  it("creates the client lazily and reuses it", async () => {
    process.env.DATABASE_URL = "postgresql://user:pw@127.0.0.1:5432/db";
    const { getDb } = await import("./client");
    const first = getDb();
    expect(first).toBeDefined();
    expect(getDb()).toBe(first);
  });
});
