import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseDeps } from "../../scripts/seed-backoffice.mjs";
import { profiles } from "./schema";

// Covers the database side of `pnpm seed:backoffice`. Everything runs in a transaction
// that is rolled back, so nothing stays behind.

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Start the local Supabase (`supabase start`) and set DATABASE_URL.",
  );
}

class Rollback extends Error {}

let client: postgres.Sql;

beforeAll(() => {
  client = postgres(url!, { max: 1 });
});

afterAll(async () => {
  await client.end();
});

/** Runs `work` with seed dependencies bound to a transaction that is always rolled back. */
async function withSeedDeps(
  work: (deps: ReturnType<typeof createDatabaseDeps>, authUserId: string) => Promise<void>,
): Promise<void> {
  const db = drizzle(client, { schema: { profiles } });
  await expect(
    db.transaction(async (tx) => {
      const [user] = await tx.execute<{ id: string }>(sql`
        insert into auth.users (id, email) values (gen_random_uuid(), 'Seed.Check@Example.be')
        returning id
      `);
      await work(createDatabaseDeps(tx), user.id);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe("seed script, database side", () => {
  it("accepts a migrated database", async () => {
    await withSeedDeps(async (deps) => {
      await expect(deps.checkDatabase()).resolves.toBeUndefined();
    });
  });

  it("finds an Auth user by e-mail, whatever the capitalisation", async () => {
    await withSeedDeps(async (deps, authUserId) => {
      expect(await deps.findAuthUserId("seed.check@example.be")).toBe(authUserId);
      expect(await deps.findAuthUserId("SEED.CHECK@EXAMPLE.BE")).toBe(authUserId);
      expect(await deps.findAuthUserId("other@example.be")).toBeNull();
    });
  });

  it("creates a backoffice profile for an existing Auth user, and is idempotent", async () => {
    await withSeedDeps(async (deps, authUserId) => {
      const input = { id: authUserId, email: "seed.check@example.be", fullName: "Seed Check" };

      expect(await deps.ensureProfile(input)).toEqual({
        created: true,
        role: "backoffice",
        isActive: true,
      });
      expect(await deps.ensureProfile(input)).toEqual({
        created: false,
        role: "backoffice",
        isActive: true,
      });
    });
  });
});
