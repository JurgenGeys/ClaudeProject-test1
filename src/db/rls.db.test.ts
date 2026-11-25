import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Row Level Security must be on for every table in `public` (ADR-0002, rule 2).
// Supabase exposes public tables through its API, so a forgotten table is a data leak.

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Start the local Supabase (`supabase start`) and set DATABASE_URL.",
  );
}

async function tablesWithoutRls(sql: postgres.Sql | postgres.TransactionSql): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by c.relname
  `;
  return rows.map((row) => row.table_name);
}

class Rollback extends Error {}

describe("Row Level Security", () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(url!, { max: 1 });
  });

  afterAll(async () => {
    await sql.end();
  });

  it("is enabled on every table in the public schema", async () => {
    expect(await tablesWithoutRls(sql)).toEqual([]);
  });

  it("covers the tables the migrations created (the check is not vacuous)", async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    expect(tables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining(["profiles", "customers", "tasks", "task_completions"]),
    );
  });

  it("detects a table without RLS (rolled back afterwards)", async () => {
    let found: string[] = [];
    let foundWithRls: string[] = [];

    await expect(
      sql.begin(async (tx) => {
        await tx`create table public.rls_check_without_rls (id int)`;
        found = await tablesWithoutRls(tx);

        await tx`alter table public.rls_check_without_rls enable row level security`;
        foundWithRls = await tablesWithoutRls(tx);

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(found).toContain("rls_check_without_rls");
    expect(foundWithRls).not.toContain("rls_check_without_rls");
    expect(await tablesWithoutRls(sql)).not.toContain("rls_check_without_rls");
  });
});
