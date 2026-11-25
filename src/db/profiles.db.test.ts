import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Checks the `profiles` migration against the real database (local Supabase in CI).
// Tests that write data run in a transaction that is always rolled back.

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Start the local Supabase (`supabase start`) and set DATABASE_URL.",
  );
}

class Rollback extends Error {}

type Tx = postgres.TransactionSql;

let sql: postgres.Sql;

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    sql.begin(async (tx) => {
      await work(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function createAuthUser(tx: Tx, email: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id
  `;
  return row.id;
}

async function createProfile(tx: Tx, email: string): Promise<string> {
  const id = await createAuthUser(tx, email);
  await tx`
    insert into public.profiles (id, full_name, email, role)
    values (${id}, 'Test User', ${email}, 'technician')
  `;
  return id;
}

async function expectSqlError(promise: PromiseLike<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

// Roles of the public Supabase API; they only exist on Supabase, not on a plain PostgreSQL.
let apiRoles: string[] = [];

beforeAll(async () => {
  sql = postgres(url!, { max: 1 });
  const roles = await sql<{ rolname: string }[]>`
    select rolname from pg_roles where rolname in ('anon', 'authenticated')
  `;
  apiRoles = roles.map((role) => role.rolname);
});

afterAll(async () => {
  await sql.end();
});

describe("profiles table", () => {
  it("exists in the public schema with the columns of the design", async () => {
    const columns = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
      order by column_name
    `;
    expect(
      Object.fromEntries(columns.map((c) => [c.column_name, [c.data_type, c.is_nullable]])),
    ).toEqual({
      created_at: ["timestamp with time zone", "NO"],
      deactivated_at: ["timestamp with time zone", "YES"],
      email: ["text", "NO"],
      full_name: ["text", "NO"],
      id: ["uuid", "NO"],
      invite_pending: ["boolean", "NO"],
      invite_verified_at: ["timestamp with time zone", "YES"],
      is_active: ["boolean", "NO"],
      role: ["USER-DEFINED", "NO"],
    });
  });

  it("starts every profile as not waiting for a password (`invite_pending` is false by default)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createProfile(tx, "no-invite@example.be");
      const [row] = await tx<{ invite_pending: boolean }[]>`
        select invite_pending from public.profiles where id = ${id}
      `;
      expect(row.invite_pending).toBe(false);
    });
  });

  it("has the user_role enum with the two roles", async () => {
    const rows = await sql<{ label: string }[]>`
      select e.enumlabel as label
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'user_role'
      order by e.enumsortorder
    `;
    expect(rows.map((row) => row.label)).toEqual(["backoffice", "technician"]);
  });

  it("has Row Level Security on and no policies, so the public API can do nothing", async () => {
    const [table] = await sql<{ relrowsecurity: boolean }[]>`
      select relrowsecurity from pg_class
      where oid = 'public.profiles'::regclass
    `;
    expect(table.relrowsecurity).toBe(true);

    const policies = await sql`
      select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles'
    `;
    expect(policies).toHaveLength(0);
  });

  it("is not readable by the anon and authenticated API roles", async (context) => {
    if (apiRoles.length === 0) {
      context.skip("anon/authenticated roles only exist on Supabase");
    }

    for (const role of apiRoles) {
      await inRolledBackTransaction(async (tx) => {
        const id = await createAuthUser(tx, "rls-check@example.be");
        await tx`
          insert into public.profiles (id, full_name, email, role)
          values (${id}, 'Rls Check', 'rls-check@example.be', 'technician')
        `;
        await tx.unsafe(`set local role ${role}`);
        // Either the grant is missing (42501) or RLS hides every row: both mean no access.
        const rows = await tx`select id from public.profiles`.catch((error: unknown) => {
          expect(error).toMatchObject({ code: "42501" });
          return [];
        });
        expect(rows).toHaveLength(0);
      });
    }
  });
});

describe("profiles and auth.users", () => {
  it("accepts a profile for an existing Auth user with sensible defaults", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createAuthUser(tx, "sofie@example.be");
      const [profile] = await tx<
        { is_active: boolean; deactivated_at: Date | null; created_at: Date }[]
      >`
        insert into public.profiles (id, full_name, email, role)
        values (${id}, 'Sofie Peeters', 'sofie@example.be', 'backoffice')
        returning is_active, deactivated_at, created_at
      `;
      expect(profile.is_active).toBe(true);
      expect(profile.deactivated_at).toBeNull();
      expect(profile.created_at).toBeInstanceOf(Date);
    });
  });

  it("rejects a profile without an Auth user (foreign key)", async () => {
    await inRolledBackTransaction(async (tx) => {
      await expectSqlError(
        tx`
          insert into public.profiles (id, full_name, email, role)
          values (gen_random_uuid(), 'Nobody', 'nobody@example.be', 'technician')
        `,
        "23503",
      );
    });
  });

  it("does not allow deleting an Auth user that has a profile (a user is deactivated, never deleted)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createAuthUser(tx, "kevin@example.be");
      await tx`
        insert into public.profiles (id, full_name, email, role)
        values (${id}, 'Kevin Wouters', 'kevin@example.be', 'technician')
      `;
      await expectSqlError(tx`delete from auth.users where id = ${id}`, "23503");
    });
  });
});

describe("profiles constraints", () => {
  it("rejects an unknown role", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createAuthUser(tx, "role@example.be");
      await expectSqlError(
        tx`
          insert into public.profiles (id, full_name, email, role)
          values (${id}, 'Role', 'role@example.be', 'admin')
        `,
        "22P02",
      );
    });
  });

  it("requires a unique e-mail address", async () => {
    await inRolledBackTransaction(async (tx) => {
      const first = await createAuthUser(tx, "double-a@example.be");
      const second = await createAuthUser(tx, "double-b@example.be");
      await tx`
        insert into public.profiles (id, full_name, email, role)
        values (${first}, 'A', 'double@example.be', 'technician')
      `;
      await expectSqlError(
        tx`
          insert into public.profiles (id, full_name, email, role)
          values (${second}, 'B', 'double@example.be', 'technician')
        `,
        "23505",
      );
    });
  });

  it("refuses is_active = false without deactivated_at", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createProfile(tx, "state-a@example.be");
      await expectSqlError(
        tx`update public.profiles set is_active = false where id = ${id}`,
        "23514",
      );
    });
  });

  it("refuses deactivated_at without is_active = false", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createProfile(tx, "state-b@example.be");
      await expectSqlError(
        tx`update public.profiles set deactivated_at = now() where id = ${id}`,
        "23514",
      );
    });
  });

  it("allows deactivating and reactivating with both fields together", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await createProfile(tx, "state-c@example.be");
      await tx`
        update public.profiles set is_active = false, deactivated_at = now() where id = ${id}
      `;
      await tx`
        update public.profiles set is_active = true, deactivated_at = null where id = ${id}
      `;
    });
  });
});
