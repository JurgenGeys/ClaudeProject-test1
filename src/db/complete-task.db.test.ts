import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { completeTaskInTransaction } from "@/lib/tasks/complete";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";

// "Taak afmelden" (BT-13) against the real database (local Supabase in CI): what is saved, every
// refusal, double completion, and what happens when the office
// resets, cancels, reassigns or edits the same task at the same moment. The first group runs in
// a transaction that is always rolled back. The races need two connections that see each other's
// locks, so their data is committed and removed again afterwards.
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

const emailSuffix = "@complete-test.example";

async function createProfile(
  tx: Pick<Db, "execute">,
  name: string,
  fields: { role?: string; isActive?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}${emailSuffix}`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  const isActive = fields.isActive ?? true;
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role, is_active, deactivated_at, invite_pending)
    values (${user.id}, ${name}, ${email}, ${fields.role ?? "technician"}, ${isActive},
            ${isActive ? null : new Date().toISOString()}, false)
  `);
  return user.id;
}

type Status = "open" | "assigned" | "picked_up" | "completed" | "invoiced" | "cancelled";

/** A task that obeys the check constraints of its status. Returns its id, number and version. */
async function seedTask(
  tx: Tx | Db,
  office: string,
  customerId: string,
  spec: { status?: Status; assignee: string | null },
) {
  const status = spec.status ?? "assigned";
  const stamp = "2026-11-20T07:48:00Z";
  const [task] = await tx.execute<{ id: string; number: number }>(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, invoiced_at, invoiced_by, cancelled_at, cancelled_by,
      created_by, updated_by
    ) values (
      ${customerId}, 'Straat 1', '2300', 'Turnhout', 'maintenance', 'Onderhoud',
      '2030-03-15', '09:00', ${spec.assignee}, ${status},
      ${["picked_up", "completed", "invoiced"].includes(status) ? stamp : null},
      ${status === "invoiced" ? stamp : null}, ${status === "invoiced" ? office : null},
      ${status === "cancelled" ? stamp : null}, ${status === "cancelled" ? office : null},
      ${office}, ${office}
    ) returning id, number
  `);
  const detail = await queryTaskDetail(tx, task.number);
  return { id: task.id, number: task.number, version: detail!.version };
}

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string) {
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, created_by) values ('Afmeld-testklant', ${createdBy})
    returning id
  `);
  return customer.id;
}

const technician = (id: string) => ({ id, role: "technician" as const, isActive: true });

async function readTask(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return row;
}

async function setUp(tx: Tx) {
  const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
  const kevin = await createProfile(tx, "Kevin Wouters");
  const jens = await createProfile(tx, "Jens Maes");
  const customerId = await createCustomer(tx, office);
  return { office, kevin, jens, customerId };
}

/** A task in the state the technician's page shows: picked up by Kevin. */
const completion = (task: { number: number; version: string }, extra = {}) => ({
  number: task.number,
  version: task.version,
  workedMinutes: 90,
  notes: "Filter vervangen" as string | null,
  ...extra,
});

async function completionsOf(tx: Pick<Db, "select">, taskId: string) {
  return tx.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, taskId));
}

describe("completeTaskInTransaction", () => {
  it("saves the hours and notes, makes the task Afgewerkt with the time of the database", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: kevin });
      const [before] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      const outcome = await completeTaskInTransaction(tx, {
        actor: technician(kevin),
        ...completion(task),
      });
      const [after] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      expect(outcome).toMatchObject({ kind: "completed", id: task.id, number: task.number });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "completed",
        assigneeId: kevin,
        updatedBy: kevin,
      });
      const rows = await completionsOf(tx, task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workedMinutes: 90,
        notes: "Filter vervangen",
        completedBy: kevin,
        correctedMinutes: null,
      });
      expect(rows[0].completedAt.getTime()).toBeGreaterThanOrEqual(Math.floor(before.now));
      expect(rows[0].completedAt.getTime()).toBeLessThanOrEqual(Math.ceil(after.now));
      // The trigger of ADR-0003 moved the version.
      expect((await queryTaskDetail(tx, task.number))!.version).not.toBe(task.version);
    });
  });

  it("accepts the smallest and the largest amount, and no notes", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      for (const workedMinutes of [15, 960]) {
        const task = await seedTask(tx, office, customerId, {
          status: "picked_up",
          assignee: kevin,
        });
        expect(
          await completeTaskInTransaction(tx, {
            actor: technician(kevin),
            ...completion(task, { workedMinutes, notes: null }),
          }),
        ).toMatchObject({ kind: "completed" });
        expect((await completionsOf(tx, task.id))[0]).toMatchObject({ workedMinutes, notes: null });
      }
    });
  });

  it("refuses hours of 0 or no quarter, however they got here: the rules and the table agree", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      for (const workedMinutes of [0, 20, -15]) {
        const task = await seedTask(tx, office, customerId, {
          status: "picked_up",
          assignee: kevin,
        });
        expect(
          await completeTaskInTransaction(tx, {
            actor: technician(kevin),
            ...completion(task, { workedMinutes }),
          }),
        ).toEqual({ kind: "refused", reason: "hours_invalid" });
        expect((await readTask(tx, task.id)).status).toBe("picked_up");
        expect(await completionsOf(tx, task.id)).toHaveLength(0);
      }
    });
  });

  it("refuses a task of a colleague, an open task and a number that does not exist, all alike", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUp(tx);
      const hers = await seedTask(tx, office, customerId, { status: "picked_up", assignee: jens });
      const open = await seedTask(tx, office, customerId, { status: "open", assignee: null });
      for (const number of [hers.number, open.number, 999_999_999]) {
        expect(
          await completeTaskInTransaction(tx, {
            actor: technician(kevin),
            ...completion(hers, { number }),
          }),
        ).toEqual({ kind: "not-assigned" });
      }
      expect((await readTask(tx, hers.id)).status).toBe("picked_up");
      expect(await completionsOf(tx, hers.id)).toHaveLength(0);
    });
  });

  it("refuses the back office, which can never complete on behalf of a technician (V10)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: kevin });
      expect(
        await completeTaskInTransaction(tx, {
          actor: { id: office, role: "backoffice", isActive: true },
          ...completion(task),
        }),
      ).toEqual({ kind: "not-assigned" });
      expect((await readTask(tx, task.id)).status).toBe("picked_up");
    });
  });

  it("refuses a task that was not picked up yet: 'changed', nothing is written", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "assigned", assignee: kevin });
      expect(
        await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      ).toEqual({ kind: "changed" });
      expect((await readTask(tx, task.id)).status).toBe("assigned");
      expect(await completionsOf(tx, task.id)).toHaveLength(0);
    });
  });

  it("tells a technician that his task was cancelled, and a colleague nothing about it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "cancelled", assignee: kevin });
      expect(
        await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      ).toEqual({ kind: "cancelled" });
      expect(
        await completeTaskInTransaction(tx, { actor: technician(jens), ...completion(task) }),
      ).toEqual({ kind: "not-assigned" });
    });
  });

  it("refuses a technician who was switched off", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUp(tx);
      const gone = await createProfile(tx, "Bram Weg", { isActive: false });
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: gone });
      expect(
        await completeTaskInTransaction(tx, { actor: technician(gone), ...completion(task) }),
      ).toEqual({ kind: "inactive" });
      expect((await readTask(tx, task.id)).status).toBe("picked_up");
      expect(await completionsOf(tx, task.id)).toHaveLength(0);
    });
  });

  it("refuses when the task was edited after the page was opened (the version)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: kevin });
      await tx
        .update(schema.tasks)
        .set({ instructions: "Andere instructies", updatedBy: office })
        .where(eq(schema.tasks.id, task.id));
      expect(
        await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      ).toEqual({ kind: "changed" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "picked_up" });
      expect(await completionsOf(tx, task.id)).toHaveLength(0);

      // After looking at the task again (a fresh version) it works.
      const fresh = (await queryTaskDetail(tx, task.number))!.version;
      expect(
        await completeTaskInTransaction(tx, {
          actor: technician(kevin),
          ...completion({ number: task.number, version: fresh }),
        }),
      ).toMatchObject({ kind: "completed" });
    });
  });
});

describe("completeTaskInTransaction: finishing twice", () => {
  it("the same hours and notes again are a silent success, even with an old version, and write nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: kevin });
      await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) });
      const before = await readTask(tx, task.id);

      expect(
        await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      ).toEqual({ kind: "already-completed" });
      expect(await readTask(tx, task.id)).toEqual(before);
      expect(await completionsOf(tx, task.id)).toHaveLength(1);

      // A colleague learns nothing about it.
      expect(
        await completeTaskInTransaction(tx, { actor: technician(jens), ...completion(task) }),
      ).toEqual({ kind: "not-assigned" });
    });
  });

  it("other hours or notes the second time are 'changed': the first report stays, nothing is thrown away silently", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: kevin });
      await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) });

      for (const other of [{ workedMinutes: 120 }, { notes: "Iets anders" }, { notes: null }]) {
        expect(
          await completeTaskInTransaction(tx, {
            actor: technician(kevin),
            ...completion(task, other),
          }),
        ).toEqual({ kind: "changed" });
      }
      const rows = await completionsOf(tx, task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ workedMinutes: 90, notes: "Filter vervangen" });
    });
  });

  it("a task that is invoiced already (and corrected) still confirms the original report", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "invoiced", assignee: kevin });
      await tx.insert(schema.taskCompletions).values({
        taskId: task.id,
        workedMinutes: 90,
        notes: "Filter vervangen",
        completedBy: kevin,
        correctedMinutes: 60,
        correctionReason: "Pauze",
        correctedBy: office,
        correctedAt: new Date(),
      });
      expect(
        await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      ).toEqual({ kind: "already-completed" });
      expect(
        await completeTaskInTransaction(tx, {
          actor: technician(kevin),
          ...completion(task, { workedMinutes: 60 }),
        }),
      ).toEqual({ kind: "changed" });
    });
  });

  it("the table itself refuses a second row for a task", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "picked_up", assignee: kevin });
      await completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) });
      await expect(
        tx.transaction((inner) =>
          inner.insert(schema.taskCompletions).values({
            taskId: task.id,
            workedMinutes: 30,
            completedBy: kevin,
          }),
        ),
      ).rejects.toThrow();
    });
  });
});

// The next tests need two connections, so their data is committed and removed afterwards.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeTestData() {
  const like = `%race%${emailSuffix}`;
  await db.execute(sql`
    delete from public.task_completions where task_id in (select id from public.tasks where created_by in
      (select id from public.profiles where email like ${like}))
  `);
  await db.execute(sql`
    delete from public.tasks where created_by in
      (select id from public.profiles where email like ${like})
  `);
  await db.execute(sql`
    delete from public.customers where created_by in
      (select id from public.profiles where email like ${like})
  `);
  await db.execute(sql`delete from public.profiles where email like ${like}`);
  await db.execute(sql`delete from auth.users where email like ${like}`);
}

async function setUpRace() {
  await removeTestData();
  const office = await createProfile(db, "Race Office", { role: "backoffice" });
  const kevin = await createProfile(db, "Race Kevin");
  const jens = await createProfile(db, "Race Jens");
  const customerId = await createCustomer(db, office);
  const task = await seedTask(db, office, customerId, { status: "picked_up", assignee: kevin });
  return { office, kevin, jens, customerId, task };
}

/** Runs `work` in a transaction on its own connection and stops before the commit until released. */
function holdOpen<T>(work: (tx: Tx) => Promise<T>) {
  const connection = connect();
  let release!: () => void;
  const mayCommit = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const isReady = new Promise<void>((resolve) => (ready = resolve));
  const result = connection.transaction(async (tx) => {
    const value = await work(tx);
    ready();
    await mayCommit;
    return value;
  });
  return { result, release, isReady };
}

/** Starts a completion on its own connection and reports whether it is still waiting. */
function startComplete(kevin: string, task: { number: number; version: string }, extra = {}) {
  let finished = false;
  const outcome = connect()
    .transaction((tx) =>
      completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task, extra) }),
    )
    .finally(() => (finished = true));
  return { outcome, isFinished: () => finished };
}

describe("completeTaskInTransaction: the office acts at the same moment", () => {
  it("a reset that is under way wins: the completion waits and is told 'changed'", async () => {
    const { office, kevin, task } = await setUpRace();
    try {
      const reset = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "assigned", pickedUpAt: null, updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await reset.isReady;

      const complete = startComplete(kevin, task);
      await sleep(400);
      expect(complete.isFinished()).toBe(false); // It waits for the lock; it does not overwrite.

      reset.release();
      await reset.result;
      expect(await complete.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "assigned", pickedUpAt: null });
      expect(await completionsOf(db, task.id)).toHaveLength(0);
    } finally {
      await removeTestData();
    }
  });

  it("a reassignment (after a reset) that is under way wins: 'not-assigned', the colleague keeps the task", async () => {
    const { office, kevin, jens, task } = await setUpRace();
    try {
      const reassign = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "assigned", pickedUpAt: null, assigneeId: jens, updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await reassign.isReady;

      const complete = startComplete(kevin, task);
      await sleep(400);
      expect(complete.isFinished()).toBe(false);

      reassign.release();
      await reassign.result;
      expect(await complete.outcome).toEqual({ kind: "not-assigned" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "assigned", assigneeId: jens });
      expect(await completionsOf(db, task.id)).toHaveLength(0);
    } finally {
      await removeTestData();
    }
  });

  it("an edit that is under way wins: the completion waits and is told 'changed'", async () => {
    const { office, kevin, task } = await setUpRace();
    try {
      const edit = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ instructions: "Andere klus", updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await edit.isReady;

      const complete = startComplete(kevin, task);
      await sleep(400);
      expect(complete.isFinished()).toBe(false);

      edit.release();
      await edit.result;
      expect(await complete.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "picked_up",
        instructions: "Andere klus",
      });
      expect(await completionsOf(db, task.id)).toHaveLength(0);
    } finally {
      await removeTestData();
    }
  });

  it("a completion that is under way wins over a reset that comes after it: the reset waits and sees Afgewerkt", async () => {
    const { office, kevin, task } = await setUpRace();
    try {
      const complete = holdOpen((tx) =>
        completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      );
      await complete.isReady;

      let resetFinished = false;
      const reset = connect()
        .transaction(async (tx) => {
          const [row] = await tx
            .select({ status: schema.tasks.status })
            .from(schema.tasks)
            .where(eq(schema.tasks.id, task.id))
            .for("update");
          return row.status;
        })
        .finally(() => (resetFinished = true));
      await sleep(400);
      expect(resetFinished).toBe(false);

      complete.release();
      expect(await complete.result).toMatchObject({ kind: "completed" });
      expect(await reset).toBe("completed"); // The office sees what really happened.
      expect(await completionsOf(db, task.id)).toHaveLength(1);
      void office;
    } finally {
      await removeTestData();
    }
  });

  it("two completions of the same task (two devices, same data): one row, both succeed", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const first = holdOpen((tx) =>
        completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      );
      await first.isReady;

      const second = startComplete(kevin, task);
      await sleep(400);
      expect(second.isFinished()).toBe(false);

      first.release();
      expect(await first.result).toMatchObject({ kind: "completed" });
      expect(await second.outcome).toEqual({ kind: "already-completed" });
      expect(await completionsOf(db, task.id)).toHaveLength(1);
      expect((await readTask(db, task.id)).status).toBe("completed");
    } finally {
      await removeTestData();
    }
  });

  it("two completions with different hours: the first wins, the second is told 'changed'", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const first = holdOpen((tx) =>
        completeTaskInTransaction(tx, { actor: technician(kevin), ...completion(task) }),
      );
      await first.isReady;
      const second = startComplete(kevin, task, { workedMinutes: 120 });
      await sleep(400);
      first.release();
      await first.result;
      expect(await second.outcome).toEqual({ kind: "changed" });
      const rows = await completionsOf(db, task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].workedMinutes).toBe(90);
    } finally {
      await removeTestData();
    }
  });

  it("a switch-off that is under way: the completion waits for the lock on his profile", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const switchOff = holdOpen((tx) => deactivateTechnicianProfile(tx, kevin));
      await switchOff.isReady;

      const complete = startComplete(kevin, task);
      await sleep(400);
      expect(complete.isFinished()).toBe(false);

      switchOff.release();
      // He has a picked up task, so the switch-off refuses and he stays active.
      expect(await switchOff.result).toMatchObject({ kind: "open-tasks" });
      expect(await complete.outcome).toMatchObject({ kind: "completed" });
    } finally {
      await removeTestData();
    }
  });
});
