import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle; stub it for tests.
vi.mock("server-only", () => ({}));

import { getDb } from "./client";

describe("getDb (real database)", () => {
  afterAll(async () => {
    await getDb().$client.end();
  });

  it("runs a query against the database", async () => {
    const rows = await getDb().execute(sql`select 1 as value`);
    expect(rows[0]).toEqual({ value: 1 });
  });
});
