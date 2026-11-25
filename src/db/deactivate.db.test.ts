import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";

// "Technieker uitschakelen" (BT-07) against the real database (local Supabase in CI): the
// profile change with its check constraint, the rule about open tasks, and the lock that keeps
// that rule true when a task is assigned at the same moment.
vi.mock("server-only", () => ({}));

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Start the local Supabase (`supabase start`) and set DATABASE_URL.",
  );
}

class Rollback extends Error {}

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const clients: postgres.Sql[] = [];
function connect(): Db {
  const client = postgres(url!, { max: 1, prepare: false });
  clients.push(client);
  return drizzle(client, { schema });
}

let db: Db;
beforeAll(() => {
  db = connect();
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()));
});

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function createProfile(
  tx: Pick<Db, "execute">,
  name: string,
  fields: { role?: string; isActive?: boolean; invitePending?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@deactivate-test.example`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  const isActive = fields.isActive ?? true;
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role, is_active, deactivated_at, invite_pending)
    values (${user.id}, ${name}, ${email}, ${fields.role ?? "technician"}, ${isActive},
            ${isActive ? null : new Date().toISOString()}, ${fields.invitePending ?? false})
  `);
  return user.id;
}

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string): Promise<string> {
  const [customer] = await tx.execute<{ id: string }>(
    sql`insert into public.customers (name, created_by) values ('Klant', ${createdBy}) returning id`,
  );
  return customer.id;
}

async function createTask(
  tx: Pick<Db, "execute">,
  customerId: string,
  createdBy: string,
  assigneeId: string | null,
  status: string,
) {
  const now = new Date().toISOString();
  const pickedUp = ["picked_up", "completed", "invoiced"].includes(status);
  const cancelled = status === "cancelled";
  const invoiced = status === "invoiced";
  await tx.execute(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, cancelled_at, cancelled_by,
      created_by, updated_by, invoiced_at, invoiced_by
    ) values (
      ${customerId}, 'Straat 1', '9000', 'Gent', 'inspection', 'Nazicht',
      '2026-12-01', '09:00', ${assigneeId}, ${status},
      ${pickedUp ? now : null}, ${cancelled ? now : null}, ${cancelled ? createdBy : null},
      ${createdBy}, ${createdBy}, ${invoiced ? now : null}, ${invoiced ? createdBy : null}
    )
  `);
}

async function readProfile(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx
    .select({
      isActive: schema.profiles.isActive,
      deactivatedAt: schema.profiles.deactivatedAt,
    })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, id));
  return row;
}

describe("deactivateTechnicianProfile", () => {
  it("sets is_active = false and deactivated_at, as the check constraint demands", async () => {
    await inRolledBackTransaction(async (tx) => {
      const bram = await createProfile(tx, "Bram Claes");
      const before = await readProfile(tx, bram);
      expect(before).toEqual({ isActive: true, deactivatedAt: null });

      expect(await deactivateTechnicianProfile(tx, bram)).toEqual({
        kind: "deactivated",
        fullName: "Bram Claes",
      });

      const after = await readProfile(tx, bram);
      expect(after.isActive).toBe(false);
      expect(after.deactivatedAt).toBeInstanceOf(Date);
    });
  });

  it("keeps finished work: completed, invoiced and cancelled tasks do not block and stay as they are", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const bram = await createProfile(tx, "Bram Claes");
      const customer = await createCustomer(tx, office);
      await createTask(tx, customer, office, bram, "completed");
      await createTask(tx, customer, office, bram, "invoiced");
      await createTask(tx, customer, office, bram, "cancelled");
      await createTask(tx, customer, office, null, "open");

      expect(await deactivateTechnicianProfile(tx, bram)).toMatchObject({ kind: "deactivated" });

      const [counts] = await tx.execute<{ total: number }>(
        sql`select count(*)::int as total from public.tasks where assignee_id = ${bram}`,
      );
      expect(counts.total).toBe(3);
    });
  });

  it("refuses with the number of Toegewezen and Opgepikt tasks, and changes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      const jens = await createProfile(tx, "Jens Maes");
      const customer = await createCustomer(tx, office);
      await createTask(tx, customer, office, kevin, "assigned");
      await createTask(tx, customer, office, kevin, "assigned");
      await createTask(tx, customer, office, kevin, "picked_up");
      await createTask(tx, customer, office, kevin, "completed");
      // A colleague's open task is not his problem.
      await createTask(tx, customer, office, jens, "assigned");

      expect(await deactivateTechnicianProfile(tx, kevin)).toEqual({
        kind: "open-tasks",
        fullName: "Kevin Wouters",
        openTasks: 3,
      });
      expect(await readProfile(tx, kevin)).toEqual({ isActive: true, deactivatedAt: null });
    });
  });

  it("is possible again once the last open task is finished or moved away", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      const jens = await createProfile(tx, "Jens Maes");
      const customer = await createCustomer(tx, office);
      await createTask(tx, customer, office, kevin, "assigned");
      expect(await deactivateTechnicianProfile(tx, kevin)).toMatchObject({ kind: "open-tasks" });

      await tx.execute(
        sql`update public.tasks set assignee_id = ${jens} where assignee_id = ${kevin}`,
      );
      expect(await deactivateTechnicianProfile(tx, kevin)).toMatchObject({ kind: "deactivated" });
    });
  });

  it("reports an unknown id, a backoffice user, an invited technician and an already switched-off one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const yana = await createProfile(tx, "Yana Willems", { invitePending: true });
      const tom = await createProfile(tx, "Tom Hendrickx", { isActive: false });

      expect(await deactivateTechnicianProfile(tx, "00000000-0000-4000-8000-000000000000")).toEqual(
        { kind: "not-found" },
      );
      // A backoffice user can never be switched off through this screen.
      expect(await deactivateTechnicianProfile(tx, office)).toEqual({ kind: "not-found" });
      expect(await readProfile(tx, office)).toMatchObject({ isActive: true });
      expect(await deactivateTechnicianProfile(tx, yana)).toEqual({
        kind: "invited",
        fullName: "Yana Willems",
      });
      expect(await readProfile(tx, yana)).toMatchObject({ isActive: true });
      expect(await deactivateTechnicianProfile(tx, tom)).toEqual({
        kind: "already-disabled",
        fullName: "Tom Hendrickx",
      });
    });
  });
});

// The next tests need two connections that see each other's locks, so their data is committed
// and removed again afterwards.
describe("deactivateTechnicianProfile: a task assigned at the same moment", () => {
  const emailSuffix = "@deactivate-test.example";

  async function removeTestData() {
    await db.execute(sql`
      delete from public.tasks where created_by in
        (select id from public.profiles where email like ${"%race%" + emailSuffix})
    `);
    await db.execute(
      sql`delete from public.customers where created_by in
        (select id from public.profiles where email like ${"%race%" + emailSuffix})`,
    );
    await db.execute(sql`delete from public.profiles where email like ${"%race%" + emailSuffix}`);
    await db.execute(sql`delete from auth.users where email like ${"%race%" + emailSuffix}`);
  }

  async function setUp() {
    await removeTestData();
    const office = await createProfile(db, "Race Office", { role: "backoffice" });
    const kevin = await createProfile(db, "Race Kevin");
    const customer = await createCustomer(db, office);
    return { office, kevin, customer };
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("counts a task whose assignment committed first, so switching off is refused", async () => {
    const { office, kevin, customer } = await setUp();
    try {
      const assigner = connect();
      let releaseAssignment!: () => void;
      const assignmentMayCommit = new Promise<void>((resolve) => (releaseAssignment = resolve));
      let assignmentLocked!: () => void;
      const locked = new Promise<void>((resolve) => (assignmentLocked = resolve));

      // The assignment (BT-08 will do the same): lock the technician with FOR SHARE, check that
      // he is active, then write the task.
      const assignment = assigner.transaction(async (tx) => {
        const [row] = await tx.execute<{ is_active: boolean }>(
          sql`select is_active from public.profiles where id = ${kevin} for share`,
        );
        expect(row.is_active).toBe(true);
        await createTask(tx, customer, office, kevin, "assigned");
        assignmentLocked();
        await assignmentMayCommit;
      });
      await locked;

      let finished = false;
      const switchOff = db
        .transaction((tx) => deactivateTechnicianProfile(tx, kevin))
        .finally(() => (finished = true));
      await sleep(400);
      // The switch-off waits for the assignment instead of counting too early.
      expect(finished).toBe(false);

      releaseAssignment();
      await assignment;
      expect(await switchOff).toEqual({
        kind: "open-tasks",
        fullName: "Race Kevin",
        openTasks: 1,
      });
      expect(await readProfile(db, kevin)).toMatchObject({ isActive: true });
    } finally {
      await removeTestData();
    }
  });

  it("makes an assignment that comes after the switch-off wait, and then see him as switched off", async () => {
    const { kevin } = await setUp();
    try {
      const assigner = connect();
      let releaseSwitchOff!: () => void;
      const switchOffMayCommit = new Promise<void>((resolve) => (releaseSwitchOff = resolve));
      let switchedOff!: () => void;
      const done = new Promise<void>((resolve) => (switchedOff = resolve));

      const switchOff = db.transaction(async (tx) => {
        const outcome = await deactivateTechnicianProfile(tx, kevin);
        switchedOff();
        await switchOffMayCommit;
        return outcome;
      });
      await done;

      // While the switch-off is open, the assignment cannot lock the technician ...
      await expect(
        assigner.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '300ms'`);
          await tx.execute(
            sql`select is_active from public.profiles where id = ${kevin} for share`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: "55P03" } });

      // ... and once it committed, the assignment reads the new state.
      releaseSwitchOff();
      expect(await switchOff).toMatchObject({ kind: "deactivated" });
      const [row] = await assigner.execute<{ is_active: boolean }>(
        sql`select is_active from public.profiles where id = ${kevin} for share`,
      );
      expect(row.is_active).toBe(false);
    } finally {
      await removeTestData();
    }
  });
});
