import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { taskStatuses, workTypes } from "@/lib/tasks/types";

// Checks the `customers`, `tasks` and `task_completions` migration against the real database
// (local Supabase in CI). Tests that write data run in a transaction that is always rolled back.

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

/**
 * Runs one statement that must fail, without poisoning the surrounding transaction. The
 * constraint that refuses it is checked too (one name, or a list when PostgreSQL may report
 * any of several), so a test cannot pass because of another rule.
 */
async function expectSqlError(
  tx: Tx,
  statement: () => PromiseLike<unknown>,
  code: string,
  constraint?: string | string[],
) {
  await tx`savepoint before_error`;
  const error: unknown = await Promise.resolve(statement()).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "the statement should have failed").not.toBeNull();
  expect(error).toMatchObject({ code });
  if (constraint !== undefined) {
    const name = (error as { constraint_name?: string }).constraint_name;
    expect(Array.isArray(constraint) ? constraint : [constraint]).toContain(name);
  }
  await tx`rollback to savepoint before_error`;
}

/** A NOT NULL violation names the column that refused the value. */
async function expectNotNull(tx: Tx, column: string, statement: () => PromiseLike<unknown>) {
  await tx`savepoint before_not_null`;
  await expect(Promise.resolve(statement())).rejects.toMatchObject({
    code: "23502",
    column_name: column,
  });
  await tx`rollback to savepoint before_not_null`;
}

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** Column values of a row to insert, by database column name. */
type Row = Record<string, string | number | Date | null>;

let counter = 0;

async function createProfile(tx: Tx, role: "backoffice" | "technician" = "technician") {
  counter += 1;
  const email = `user-${counter}-${Math.random().toString(36).slice(2)}@example.be`;
  const [user] = await tx<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id
  `;
  await tx`
    insert into public.profiles (id, full_name, email, role)
    values (${user.id}, 'Test User', ${email}, ${role})
  `;
  return user.id;
}

async function createCustomer(tx: Tx, createdBy: string) {
  const [row] = await tx<{ id: string }[]>`
    insert into public.customers (name, created_by) values ('Bakkerij De Gouden Korst', ${createdBy})
    returning id
  `;
  return row.id;
}

interface World {
  office: string;
  kevin: string;
  bram: string;
  customer: string;
}

async function createWorld(tx: Tx): Promise<World> {
  const office = await createProfile(tx, "backoffice");
  const kevin = await createProfile(tx);
  const bram = await createProfile(tx);
  const customer = await createCustomer(tx, office);
  return { office, kevin, bram, customer };
}

/** Inserts a task; `fields` overrides columns by their database name. */
async function insertTask(tx: Tx, world: World, fields: Row = {}) {
  const row = {
    customer_id: world.customer,
    location_street: "Kerkstraat 12",
    location_postal_code: "2310",
    location_city: "Rijkevorsel",
    work_type: "maintenance",
    instructions: "Jaarlijks onderhoud",
    scheduled_date: "2026-11-25",
    start_time: "14:00",
    created_by: world.office,
    updated_by: world.office,
    ...fields,
  };
  const [task] = await tx<{ id: string; number: number }[]>`
    insert into public.tasks ${tx(row as Row)} returning id, number
  `;
  return task;
}

async function insertCompletion(tx: Tx, taskId: string, completedBy: string, fields: Row = {}) {
  const row = { task_id: taskId, worked_minutes: 90, completed_by: completedBy, ...fields };
  const [completion] = await tx<{ id: string }[]>`
    insert into public.task_completions ${tx(row as Row)} returning id
  `;
  return completion;
}

const NOW = new Date("2026-11-25T09:00:00Z");

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

describe("enums", () => {
  async function labels(typeName: string): Promise<string[]> {
    const rows = await sql<{ label: string }[]>`
      select e.enumlabel as label
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = ${typeName}
      order by e.enumsortorder
    `;
    return rows.map((row) => row.label);
  }

  it("task_status has the six statuses, the same as the code", async () => {
    expect(await labels("task_status")).toEqual([
      "open",
      "assigned",
      "picked_up",
      "completed",
      "invoiced",
      "cancelled",
    ]);
    expect(await labels("task_status")).toEqual([...taskStatuses]);
  });

  it("work_type has the three kinds of work, the same as the code", async () => {
    expect(await labels("work_type")).toEqual(["inspection", "maintenance", "repair"]);
    expect(await labels("work_type")).toEqual([...workTypes]);
  });
});

describe("tables", () => {
  async function columns(table: string) {
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = ${table}
    `;
    return Object.fromEntries(rows.map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
  }

  it("customers has the columns of the design", async () => {
    expect(await columns("customers")).toEqual({
      id: ["uuid", "NO"],
      name: ["text", "NO"],
      street: ["text", "YES"],
      postal_code: ["text", "YES"],
      city: ["text", "YES"],
      phone: ["text", "YES"],
      email: ["text", "YES"],
      notes: ["text", "YES"],
      created_at: ["timestamp with time zone", "NO"],
      created_by: ["uuid", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    });
  });

  it("tasks has the columns of the design", async () => {
    expect(await columns("tasks")).toEqual({
      id: ["uuid", "NO"],
      number: ["integer", "NO"],
      customer_id: ["uuid", "NO"],
      location_street: ["text", "NO"],
      location_postal_code: ["text", "NO"],
      location_city: ["text", "NO"],
      work_type: ["USER-DEFINED", "NO"],
      instructions: ["text", "NO"],
      scheduled_date: ["date", "NO"],
      start_time: ["time without time zone", "NO"],
      estimated_minutes: ["integer", "YES"],
      assignee_id: ["uuid", "YES"],
      status: ["USER-DEFINED", "NO"],
      picked_up_at: ["timestamp with time zone", "YES"],
      invoiced_at: ["timestamp with time zone", "YES"],
      invoiced_by: ["uuid", "YES"],
      cancelled_at: ["timestamp with time zone", "YES"],
      cancelled_by: ["uuid", "YES"],
      cancellation_reason: ["text", "YES"],
      created_at: ["timestamp with time zone", "NO"],
      created_by: ["uuid", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
      updated_by: ["uuid", "NO"],
    });
  });

  it("task_completions has the columns of the design", async () => {
    expect(await columns("task_completions")).toEqual({
      id: ["uuid", "NO"],
      task_id: ["uuid", "NO"],
      worked_minutes: ["integer", "NO"],
      notes: ["text", "YES"],
      completed_by: ["uuid", "NO"],
      completed_at: ["timestamp with time zone", "NO"],
      corrected_minutes: ["integer", "YES"],
      correction_reason: ["text", "YES"],
      corrected_by: ["uuid", "YES"],
      corrected_at: ["timestamp with time zone", "YES"],
    });
  });

  it("has the indexes for the lists of the design", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('customers', 'tasks', 'task_completions')
    `;
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    expect(defs["tasks_assignee_status_date_idx"]).toContain(
      "(assignee_id, status, scheduled_date)",
    );
    expect(defs["tasks_status_date_idx"]).toContain("(status, scheduled_date)");
    expect(defs["tasks_scheduled_date_idx"]).toContain("(scheduled_date)");
    expect(defs["tasks_customer_idx"]).toContain("(customer_id)");
    expect(defs["tasks_number_unique"]).toContain("UNIQUE");
    expect(defs["task_completions_task_id_unique"]).toContain("UNIQUE");
    expect(defs["task_completions_completed_at_idx"]).toContain("(completed_at)");
    expect(defs["customers_lower_name_idx"]).toContain("lower(name)");
  });
});

describe("Row Level Security and the public API", () => {
  const tables = ["customers", "tasks", "task_completions"];

  it("is on for every new table, without any policy", async () => {
    for (const table of tables) {
      const [row] = await sql<{ relrowsecurity: boolean }[]>`
        select relrowsecurity from pg_class where oid = ${`public.${table}`}::regclass
      `;
      expect(row.relrowsecurity, table).toBe(true);
    }
    const policies = await sql`
      select tablename from pg_policies where schemaname = 'public' and tablename in ${sql(tables)}
    `;
    expect(policies).toHaveLength(0);
  });

  it("cannot be read by the anon and authenticated API roles", async (context) => {
    if (apiRoles.length === 0) {
      context.skip("anon/authenticated roles only exist on Supabase");
    }

    for (const role of apiRoles) {
      await inRolledBackTransaction(async (tx) => {
        const world = await createWorld(tx);
        const task = await insertTask(tx, world, {
          status: "completed",
          assignee_id: world.kevin,
          picked_up_at: NOW,
        });
        await insertCompletion(tx, task.id, world.kevin);

        await tx.unsafe(`set local role ${role}`);
        for (const table of tables) {
          // Either the grant is missing (42501) or RLS hides every row: both mean no access.
          await tx`savepoint read_table`;
          const rows = await tx.unsafe(`select * from public.${table}`).catch((error: unknown) => {
            expect(error).toMatchObject({ code: "42501" });
            return [];
          });
          expect(rows, `${role} reads ${table}`).toHaveLength(0);
          await tx`rollback to savepoint read_table`;
        }
      });
    }
  });

  it("cannot be written by the anon and authenticated API roles (insert, update, delete)", async (context) => {
    if (apiRoles.length === 0) {
      context.skip("anon/authenticated roles only exist on Supabase");
    }

    for (const role of apiRoles) {
      await inRolledBackTransaction(async (tx) => {
        const w = await createWorld(tx);
        const task = await insertTask(tx, w, {
          status: "completed",
          assignee_id: w.kevin,
          picked_up_at: NOW,
        });
        await insertCompletion(tx, task.id, w.kevin);
        await tx.unsafe(`set local role ${role}`);

        // Inserts: refused with 42501 (no grant, or RLS without a policy).
        const inserts: Record<string, () => PromiseLike<unknown>> = {
          customers: () =>
            tx`insert into public.customers (name, created_by) values ('x', ${w.office})`,
          tasks: () => insertTask(tx, w),
          task_completions: () => insertCompletion(tx, task.id, w.kevin),
        };
        for (const statement of Object.values(inserts)) {
          await expectSqlError(tx, statement, "42501");
        }

        // Updates and deletes: either refused (42501) or RLS hides every row, so 0 rows change.
        const changes = [
          `update public.customers set name = 'changed'`,
          `update public.tasks set instructions = 'changed'`,
          `update public.task_completions set notes = 'changed'`,
          `delete from public.customers`,
          `delete from public.tasks`,
          `delete from public.task_completions`,
        ];
        for (const change of changes) {
          await tx`savepoint change_table`;
          const result = await tx.unsafe(change).then(
            (rows) => rows.count,
            (error: unknown) => {
              expect(error, change).toMatchObject({ code: "42501" });
              return 0;
            },
          );
          expect(result, `${role}: ${change}`).toBe(0);
          await tx`rollback to savepoint change_table`;
        }
      });
    }
  });
});

describe("tasks: task number", () => {
  it("is handed out by the database as an identity column starting at 1001", async () => {
    const [column] = await sql<
      { is_identity: string; identity_generation: string; identity_start: string }[]
    >`
      select is_identity, identity_generation, identity_start
      from information_schema.columns
      where table_schema = 'public' and table_name = 'tasks' and column_name = 'number'
    `;
    expect(column).toEqual({
      is_identity: "YES",
      identity_generation: "ALWAYS",
      identity_start: "1001",
    });
  });

  it("is at least 1001, increases per task and is unique", async () => {
    await inRolledBackTransaction(async (tx) => {
      const world = await createWorld(tx);
      const first = await insertTask(tx, world);
      const second = await insertTask(tx, world);
      expect(first.number).toBeGreaterThanOrEqual(1001);
      expect(second.number).toBeGreaterThan(first.number);

      const numbers = await tx<{ number: number }[]>`select number from public.tasks`;
      expect(new Set(numbers.map((row) => row.number)).size).toBe(numbers.length);
    });
  });

  it("starts at 1001 for a fresh sequence", async () => {
    await inRolledBackTransaction(async (tx) => {
      // The sequence of the real table may have moved (other tests, other runs), so check a
      // twin table made the same way. Nothing of this stays: the transaction is rolled back.
      await tx`create table public.number_start_check (n integer generated always as identity (start with 1001))`;
      const [row] = await tx<{ n: number }[]>`
        insert into public.number_start_check default values returning n
      `;
      expect(row.n).toBe(1001);
    });
  });

  it("cannot be chosen or changed by a user, and cannot be given twice", async () => {
    await inRolledBackTransaction(async (tx) => {
      const world = await createWorld(tx);
      const task = await insertTask(tx, world);
      await expectSqlError(
        tx,
        () => insertTask(tx, world, { number: 5000 }),
        "428C9", // cannot insert a non-DEFAULT value into an identity column "always"
      );
      await expectSqlError(
        tx,
        () => tx`update public.tasks set number = 5 where id = ${task.id}`,
        "428C9",
      );
    });
  });
});

describe("tasks: defaults and required fields", () => {
  it("starts Open without technician, with timestamps filled in", async () => {
    await inRolledBackTransaction(async (tx) => {
      const world = await createWorld(tx);
      const task = await insertTask(tx, world);
      const [row] = await tx<
        {
          status: string;
          assignee_id: string | null;
          estimated_minutes: number | null;
          created_at: Date;
          updated_at: Date;
          scheduled_date: string;
          start_time: string;
        }[]
      >`
        select status, assignee_id, estimated_minutes, created_at, updated_at,
               scheduled_date::text as scheduled_date, start_time::text as start_time
        from public.tasks where id = ${task.id}
      `;
      expect(row.status).toBe("open");
      expect(row.assignee_id).toBeNull();
      expect(row.estimated_minutes).toBeNull();
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.updated_at).toBeInstanceOf(Date);
      expect(row.scheduled_date).toBe("2026-11-25");
      expect(row.start_time).toBe("14:00:00");
    });
  });

  it("requires the kind of work and refuses an unknown one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const world = await createWorld(tx);
      await expectNotNull(tx, "work_type", () => insertTask(tx, world, { work_type: null }));
      await expectSqlError(tx, () => insertTask(tx, world, { work_type: "installation" }), "22P02");
    });
  });

  it("requires a customer, location, instructions, date, start time and creator", async () => {
    await inRolledBackTransaction(async (tx) => {
      const world = await createWorld(tx);
      for (const column of [
        "customer_id",
        "location_street",
        "location_postal_code",
        "location_city",
        "instructions",
        "scheduled_date",
        "start_time",
        "created_by",
        "updated_by",
      ]) {
        await expectNotNull(tx, column, () => insertTask(tx, world, { [column]: null }));
      }
    });
  });
});

describe("tasks: check constraints per status", () => {
  it("accepts every valid combination of the design", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await insertTask(tx, w, { status: "open" });
      await insertTask(tx, w, { status: "assigned", assignee_id: w.kevin });
      await insertTask(tx, w, { status: "picked_up", assignee_id: w.kevin, picked_up_at: NOW });
      await insertTask(tx, w, { status: "completed", assignee_id: w.kevin, picked_up_at: NOW });
      await insertTask(tx, w, {
        status: "invoiced",
        assignee_id: w.kevin,
        picked_up_at: NOW,
        invoiced_at: NOW,
        invoiced_by: w.office,
      });
      // Cancelled with and without the last technician, with and without a reason.
      await insertTask(tx, w, { status: "cancelled", cancelled_at: NOW, cancelled_by: w.office });
      await insertTask(tx, w, {
        status: "cancelled",
        assignee_id: w.kevin,
        cancelled_at: NOW,
        cancelled_by: w.office,
        cancellation_reason: "Klant heeft zelf afgezegd",
      });
    });
  });

  it("Open must not have a technician; every active status must have one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "open", assignee_id: w.kevin }),
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "assigned" }),
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "picked_up", picked_up_at: NOW }),
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "completed", picked_up_at: NOW }),
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
      await expectSqlError(
        tx,
        () =>
          insertTask(tx, w, {
            status: "invoiced",
            picked_up_at: NOW,
            invoiced_at: NOW,
            invoiced_by: w.office,
          }),
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
    });
  });

  it("refuses 'Nog niet toewijzen' that forgets to clear the status, and the reverse", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await insertTask(tx, w, { status: "assigned", assignee_id: w.kevin });
      await expectSqlError(
        tx,
        () => tx`update public.tasks set assignee_id = null where id = ${task.id}`,
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
      await expectSqlError(
        tx,
        () => tx`update public.tasks set status = 'open' where id = ${task.id}`,
        CHECK_VIOLATION,
        "tasks_assignee_matches_status",
      );
      await tx`update public.tasks set status = 'open', assignee_id = null where id = ${task.id}`;
    });
  });

  it("picked_up_at is set from Opgepikt on, and empty before and when cancelled", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "picked_up", assignee_id: w.kevin }),
        CHECK_VIOLATION,
        "tasks_picked_up_at_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "completed", assignee_id: w.kevin }),
        CHECK_VIOLATION,
        "tasks_picked_up_at_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "assigned", assignee_id: w.kevin, picked_up_at: NOW }),
        CHECK_VIOLATION,
        "tasks_picked_up_at_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "open", picked_up_at: NOW }),
        CHECK_VIOLATION,
        "tasks_picked_up_at_matches_status",
      );
      await expectSqlError(
        tx,
        () =>
          insertTask(tx, w, {
            status: "cancelled",
            picked_up_at: NOW,
            cancelled_at: NOW,
            cancelled_by: w.office,
          }),
        CHECK_VIOLATION,
        "tasks_picked_up_at_matches_status",
      );
    });
  });

  it("Terugzetten must clear picked_up_at together with the status", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await insertTask(tx, w, {
        status: "picked_up",
        assignee_id: w.kevin,
        picked_up_at: NOW,
      });
      await expectSqlError(
        tx,
        () => tx`update public.tasks set status = 'assigned' where id = ${task.id}`,
        CHECK_VIOLATION,
        "tasks_picked_up_at_matches_status",
      );
      await tx`update public.tasks set status = 'assigned', picked_up_at = null where id = ${task.id}`;
    });
  });

  it("invoiced_at and invoiced_by are filled if and only if the status is Gefactureerd", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const completed = { status: "completed", assignee_id: w.kevin, picked_up_at: NOW };
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { ...completed, status: "invoiced" }),
        CHECK_VIOLATION,
        "tasks_invoiced_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { ...completed, status: "invoiced", invoiced_at: NOW }),
        CHECK_VIOLATION,
        "tasks_invoiced_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { ...completed, status: "invoiced", invoiced_by: w.office }),
        CHECK_VIOLATION,
        "tasks_invoiced_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { ...completed, invoiced_at: NOW, invoiced_by: w.office }),
        CHECK_VIOLATION,
        "tasks_invoiced_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { ...completed, invoiced_at: NOW }),
        CHECK_VIOLATION,
        "tasks_invoiced_matches_status",
      );
    });
  });

  it("'Markering ongedaan maken' must clear invoiced_at and invoiced_by", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await insertTask(tx, w, {
        status: "invoiced",
        assignee_id: w.kevin,
        picked_up_at: NOW,
        invoiced_at: NOW,
        invoiced_by: w.office,
      });
      await expectSqlError(
        tx,
        () => tx`update public.tasks set status = 'completed' where id = ${task.id}`,
        CHECK_VIOLATION,
        "tasks_invoiced_matches_status",
      );
      await tx`
        update public.tasks set status = 'completed', invoiced_at = null, invoiced_by = null
        where id = ${task.id}
      `;
    });
  });

  it("cancelled_at and cancelled_by are filled if and only if the status is Geannuleerd", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "cancelled" }),
        CHECK_VIOLATION,
        "tasks_cancelled_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "cancelled", cancelled_at: NOW }),
        CHECK_VIOLATION,
        "tasks_cancelled_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { status: "cancelled", cancelled_by: w.office }),
        CHECK_VIOLATION,
        "tasks_cancelled_matches_status",
      );
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { cancelled_at: NOW, cancelled_by: w.office }),
        CHECK_VIOLATION,
        "tasks_cancelled_matches_status",
      );
      await expectSqlError(
        tx,
        () =>
          insertTask(tx, w, {
            status: "assigned",
            assignee_id: w.kevin,
            cancelled_at: NOW,
            cancelled_by: w.office,
          }),
        CHECK_VIOLATION,
        "tasks_cancelled_matches_status",
      );
    });
  });

  it("cancels an Open or Toegewezen task, and keeps the technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await insertTask(tx, w, { status: "assigned", assignee_id: w.kevin });
      await tx`
        update public.tasks
        set status = 'cancelled', cancelled_at = now(), cancelled_by = ${w.office},
            cancellation_reason = 'Klant heeft zelf afgezegd'
        where id = ${task.id}
      `;
      const [row] = await tx<{ assignee_id: string }[]>`
        select assignee_id from public.tasks where id = ${task.id}
      `;
      expect(row.assignee_id).toBe(w.kevin);
    });
  });

  it("a cancellation reason only exists on a cancelled task and has at most 500 characters", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { cancellation_reason: "Zomaar" }),
        CHECK_VIOLATION,
        "tasks_cancellation_reason_valid",
      );
      const cancelled = { status: "cancelled", cancelled_at: NOW, cancelled_by: w.office };
      await insertTask(tx, w, { ...cancelled, cancellation_reason: "x".repeat(500) });
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { ...cancelled, cancellation_reason: "x".repeat(501) }),
        CHECK_VIOLATION,
        "tasks_cancellation_reason_valid",
      );
    });
  });
});

describe("tasks: estimated duration", () => {
  it("is optional and must be more than 0 and a multiple of 15 minutes", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await insertTask(tx, w, { estimated_minutes: null });
      await insertTask(tx, w, { estimated_minutes: 15 });
      await insertTask(tx, w, { estimated_minutes: 90 });
      for (const minutes of [0, -15, 10, 100]) {
        await expectSqlError(
          tx,
          () => insertTask(tx, w, { estimated_minutes: minutes }),
          CHECK_VIOLATION,
          "tasks_estimated_minutes_valid",
        );
      }
    });
  });
});

describe("task_completions", () => {
  async function completedTask(tx: Tx, w: World) {
    return insertTask(tx, w, { status: "completed", assignee_id: w.kevin, picked_up_at: NOW });
  }

  it("stores the hours as reported, with notes and who and when", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin, {
        worked_minutes: 90,
        notes: "Filter vervangen",
      });
      const [row] = await tx<
        {
          worked_minutes: number;
          corrected_minutes: number | null;
          completed_at: Date;
          notes: string;
        }[]
      >`select * from public.task_completions where task_id = ${task.id}`;
      expect(row.worked_minutes).toBe(90);
      expect(row.corrected_minutes).toBeNull();
      expect(row.completed_at).toBeInstanceOf(Date);
      expect(row.notes).toBe("Filter vervangen");
    });
  });

  it("allows one completion per task", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin);
      await expectSqlError(
        tx,
        () => insertCompletion(tx, task.id, w.kevin),
        UNIQUE_VIOLATION,
        "task_completions_task_id_unique",
      );
    });
  });

  it("worked minutes must be more than 0 and a multiple of 15", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      for (const minutes of [0, -15, 10, 100]) {
        await expectSqlError(
          tx,
          () => insertCompletion(tx, task.id, w.kevin, { worked_minutes: minutes }),
          CHECK_VIOLATION,
          "task_completions_worked_minutes_valid",
        );
      }
      await expectNotNull(tx, "worked_minutes", () =>
        insertCompletion(tx, task.id, w.kevin, { worked_minutes: null }),
      );
    });
  });

  it("has no maximum on the hours: that is in the Zod schemas", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin, { worked_minutes: 24 * 60 });
    });
  });

  it("limits the notes to 2000 characters", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const first = await completedTask(tx, w);
      const second = await completedTask(tx, w);
      await insertCompletion(tx, first.id, w.kevin, { notes: "x".repeat(2000) });
      await expectSqlError(
        tx,
        () => insertCompletion(tx, second.id, w.kevin, { notes: "x".repeat(2001) }),
        CHECK_VIOLATION,
        "task_completions_notes_length",
      );
    });
  });

  it("keeps the original hours next to a complete correction", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin, { worked_minutes: 120 });
      await tx`
        update public.task_completions
        set corrected_minutes = 90, correction_reason = 'Pauze niet afgetrokken',
            corrected_by = ${w.office}, corrected_at = now()
        where task_id = ${task.id}
      `;
      const [row] = await tx<{ worked_minutes: number; effective: number }[]>`
        select worked_minutes, coalesce(corrected_minutes, worked_minutes) as effective
        from public.task_completions where task_id = ${task.id}
      `;
      expect(row).toEqual({ worked_minutes: 120, effective: 90 });
    });
  });

  it("refuses a correction that is not complete (hours, reason, who, when come together)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin);
      const attempts = [
        tx`update public.task_completions set corrected_minutes = 60 where task_id = ${task.id}`,
        tx`update public.task_completions set correction_reason = 'Pauze' where task_id = ${task.id}`,
        tx`update public.task_completions set corrected_by = ${w.office} where task_id = ${task.id}`,
        tx`update public.task_completions set corrected_at = now() where task_id = ${task.id}`,
        tx`update public.task_completions
           set corrected_minutes = 60, corrected_by = ${w.office}, corrected_at = now()
           where task_id = ${task.id}`,
      ];
      // Each statement is built above but only sent when awaited, so run them one by one.
      for (const attempt of attempts) {
        await expectSqlError(
          tx,
          () => attempt,
          CHECK_VIOLATION,
          "task_completions_correction_complete",
        );
      }
    });
  });

  it("refuses an empty or blank reason for a correction", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin);
      for (const reason of ["", "   "]) {
        await expectSqlError(
          tx,
          () => tx`
            update public.task_completions
            set corrected_minutes = 60, correction_reason = ${reason},
                corrected_by = ${w.office}, corrected_at = now()
            where task_id = ${task.id}
          `,
          CHECK_VIOLATION,
          "task_completions_correction_reason_not_blank",
        );
      }
    });
  });

  it("corrected minutes must be more than 0 and a multiple of 15", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await completedTask(tx, w);
      await insertCompletion(tx, task.id, w.kevin);
      for (const minutes of [0, -15, 20]) {
        await expectSqlError(
          tx,
          () => tx`
            update public.task_completions
            set corrected_minutes = ${minutes}, correction_reason = 'Pauze',
                corrected_by = ${w.office}, corrected_at = now()
            where task_id = ${task.id}
          `,
          CHECK_VIOLATION,
          "task_completions_corrected_minutes_valid",
        );
      }
    });
  });
});

describe("ON DELETE RESTRICT: nothing is deleted", () => {
  it("every foreign key of the new tables is ON DELETE RESTRICT", async () => {
    const rows = await sql<{ conname: string; confdeltype: string }[]>`
      select conname, confdeltype
      from pg_constraint
      where contype = 'f' and conrelid in (
        'public.customers'::regclass, 'public.tasks'::regclass, 'public.task_completions'::regclass
      )
    `;
    // customers 1, tasks 6 (customer, assignee, invoiced_by, cancelled_by, created_by, updated_by), task_completions 3.
    expect(rows.length).toBe(10);
    // 'r' = RESTRICT
    expect(rows.filter((row) => row.confdeltype !== "r")).toEqual([]);
  });

  it("a customer with tasks cannot be deleted", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await insertTask(tx, w);
      await expectSqlError(
        tx,
        () => tx`delete from public.customers where id = ${w.customer}`,
        FOREIGN_KEY_VIOLATION,
        "tasks_customer_id_customers_id_fk",
      );
    });
  });

  it("a technician with tasks, a back office user who created tasks and a cancelling user cannot be deleted", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await insertTask(tx, w, { status: "assigned", assignee_id: w.kevin });
      await insertTask(tx, w, {
        status: "cancelled",
        assignee_id: w.bram,
        cancelled_at: NOW,
        cancelled_by: w.office,
      });
      for (const profile of [w.kevin, w.bram, w.office]) {
        await expectSqlError(
          tx,
          () => tx`delete from public.profiles where id = ${profile}`,
          FOREIGN_KEY_VIOLATION,
          [
            "tasks_assignee_id_profiles_id_fk",
            "tasks_created_by_profiles_id_fk",
            "tasks_updated_by_profiles_id_fk",
            "tasks_cancelled_by_profiles_id_fk",
            "customers_created_by_profiles_id_fk",
          ],
        );
      }
    });
  });

  it("a task with a completion cannot be deleted, nor the technician who completed it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const task = await insertTask(tx, w, {
        status: "completed",
        assignee_id: w.kevin,
        picked_up_at: NOW,
      });
      await insertCompletion(tx, task.id, w.kevin);
      await expectSqlError(
        tx,
        () => tx`delete from public.tasks where id = ${task.id}`,
        FOREIGN_KEY_VIOLATION,
        "task_completions_task_id_tasks_id_fk",
      );
      await expectSqlError(
        tx,
        () => tx`delete from public.profiles where id = ${w.kevin}`,
        FOREIGN_KEY_VIOLATION,
        ["task_completions_completed_by_profiles_id_fk", "tasks_assignee_id_profiles_id_fk"],
      );
    });
  });

  it("refuses references to rows that do not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      await expectSqlError(
        tx,
        () => insertTask(tx, w, { customer_id: "00000000-0000-4000-8000-000000000000" }),
        FOREIGN_KEY_VIOLATION,
        "tasks_customer_id_customers_id_fk",
      );
      await expectSqlError(
        tx,
        () =>
          insertTask(tx, w, {
            status: "assigned",
            assignee_id: "00000000-0000-4000-8000-000000000000",
          }),
        FOREIGN_KEY_VIOLATION,
        "tasks_assignee_id_profiles_id_fk",
      );
    });
  });
});
