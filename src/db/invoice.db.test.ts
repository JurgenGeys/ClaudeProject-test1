import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { markInvoicedInTransaction, unmarkInvoicedInTransaction } from "@/lib/tasks/invoice";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { queryTaskOverview } from "@/lib/tasks/overview";
import { parseTaskOverviewParams } from "@/lib/validation/task-overview";

// "Markeer als gefactureerd" and "Markering ongedaan maken" (BT-17) against the real database
// (local Supabase in CI): what is saved, every refusal, marking twice, and what happens when
// hours are corrected or the task is edited at the same moment. The first group runs in a
// transaction that is always rolled back. The races need two connections that see each other's
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

const emailSuffix = "@invoice-test.example";

async function createProfile(
  tx: Pick<Db, "execute">,
  name: string,
  fields: { role?: string } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}${emailSuffix}`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role, is_active, invite_pending)
    values (${user.id}, ${name}, ${email}, ${fields.role ?? "technician"}, true, false)
  `);
  return user.id;
}

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string) {
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, created_by) values ('Factuur-testklant', ${createdBy})
    returning id
  `);
  return customer.id;
}

type Status = "open" | "assigned" | "picked_up" | "completed" | "invoiced" | "cancelled";

/** A task that obeys the check constraints of its status, with the hours of a finished one. */
async function seedTask(
  tx: Tx | Db,
  office: string,
  customerId: string,
  technicianId: string,
  status: Status = "completed",
) {
  const stamp = "2026-11-20T07:48:00Z";
  const [task] = await tx.execute<{ id: string; number: number }>(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, invoiced_at, invoiced_by,
      cancelled_at, cancelled_by, created_by, updated_by
    ) values (
      ${customerId}, 'Straat 1', '2300', 'Turnhout', 'maintenance', 'Onderhoud',
      '2030-03-15', '09:00', ${status === "open" ? null : technicianId}, ${status},
      ${["picked_up", "completed", "invoiced"].includes(status) ? stamp : null},
      ${status === "invoiced" ? stamp : null}, ${status === "invoiced" ? office : null},
      ${status === "cancelled" ? stamp : null}, ${status === "cancelled" ? office : null},
      ${office}, ${office}
    ) returning id, number
  `);
  if (status === "completed" || status === "invoiced") {
    await tx.insert(schema.taskCompletions).values({
      taskId: task.id,
      workedMinutes: 120,
      completedBy: technicianId,
    });
  }
  const detail = await queryTaskDetail(tx, task.number);
  return { id: task.id, number: task.number, version: detail!.version };
}

type Seeded = Awaited<ReturnType<typeof seedTask>>;
const ref = (task: { number: number; version: string }) => ({
  number: task.number,
  version: task.version,
});

const backoffice = (id: string) => ({ id, role: "backoffice" as const, isActive: true });

async function readTask(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return row;
}

async function readCompletion(tx: Pick<Db, "select">, taskId: string) {
  const [row] = await tx
    .select()
    .from(schema.taskCompletions)
    .where(eq(schema.taskCompletions.taskId, taskId));
  return row;
}

/**
 * What the back office does when it corrects hours (BT-15): lock the task, change the
 * completion and touch the task row, so that its version moves. Plain SQL: this test does not
 * depend on how `correctHours` will be written, only on the lock and the version.
 */
async function correctHours(tx: Tx | Db, office: string, task: Seeded, minutes: number) {
  await tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).for("update");
  await tx
    .update(schema.taskCompletions)
    .set({
      correctedMinutes: minutes,
      correctionReason: "pauze niet afgetrokken",
      correctedBy: office,
      correctedAt: new Date(),
    })
    .where(eq(schema.taskCompletions.taskId, task.id));
  await tx.update(schema.tasks).set({ updatedBy: office }).where(eq(schema.tasks.id, task.id));
}

async function setUp(tx: Tx | Db) {
  const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
  const kevin = await createProfile(tx, "Kevin Wouters");
  const customerId = await createCustomer(tx, office);
  return { office, kevin, customerId };
}

describe("markInvoicedInTransaction", () => {
  it("makes Afgewerkt tasks Gefactureerd with who and when (the clock of the database), and keeps the hours", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const a = await seedTask(tx, office, customerId, kevin);
      const b = await seedTask(tx, office, customerId, kevin);
      const [before] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      const outcome = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [ref(b), ref(a)],
      });
      const [after] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      expect(outcome).toEqual({
        kind: "done",
        marked: [a.number, b.number].sort((x, y) => x - y),
        alreadyInvoiced: [],
        changed: [],
      });
      const rows = [await readTask(tx, a.id), await readTask(tx, b.id)];
      for (const row of rows) {
        expect(row).toMatchObject({ status: "invoiced", invoicedBy: office, updatedBy: office });
        expect(row.invoicedAt!.getTime()).toBeGreaterThanOrEqual(Math.floor(before.now));
        expect(row.invoicedAt!.getTime()).toBeLessThanOrEqual(Math.ceil(after.now));
      }
      // The whole selection is marked at one moment.
      expect(rows[0].invoicedAt!.getTime()).toBe(rows[1].invoicedAt!.getTime());
      expect(await readCompletion(tx, a.id)).toMatchObject({
        workedMinutes: 120,
        correctedMinutes: null,
      });
      // The trigger of ADR-0003 moved the version.
      expect((await queryTaskDetail(tx, a.number))!.version).not.toBe(a.version);
    });
  });

  it("marks the hours that count: a correction made before the page was opened is invoiced", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await correctHours(tx, office, task, 90);
      const opened = (await queryTaskDetail(tx, task.number))!;

      const outcome = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [{ number: task.number, version: opened.version }],
      });
      expect(outcome).toMatchObject({ kind: "done", marked: [task.number] });
      expect(await readCompletion(tx, task.id)).toMatchObject({ correctedMinutes: 90 });
    });
  });

  it("reports a task that was Gefactureerd already and leaves it as it was", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const done = await seedTask(tx, office, customerId, kevin, "invoiced");
      const todo = await seedTask(tx, office, customerId, kevin);
      const before = await readTask(tx, done.id);

      const outcome = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [ref(done), ref(todo)],
      });
      expect(outcome).toMatchObject({
        marked: [todo.number],
        alreadyInvoiced: [done.number],
        changed: [],
      });
      expect(await readTask(tx, done.id)).toEqual(before);
    });
  });

  it("marks a selection twice only once: the second time everything was already invoiced", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const input = { actor: backoffice(office), tasks: [ref(task)] };
      await markInvoicedInTransaction(tx, input);
      const first = await readTask(tx, task.id);

      const again = await markInvoicedInTransaction(tx, input);
      expect(again).toEqual({
        kind: "done",
        marked: [],
        alreadyInvoiced: [task.number],
        changed: [],
      });
      expect(await readTask(tx, task.id)).toEqual(first);
    });
  });

  it("does not mark a task whose hours were corrected after the page was opened", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await correctHours(tx, office, task, 60);

      const outcome = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [ref(task)],
      });
      expect(outcome).toEqual({
        kind: "done",
        marked: [],
        alreadyInvoiced: [],
        changed: [task.number],
      });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "completed", invoicedAt: null });
    });
  });

  it("marks the rest of the selection when one task changed", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const stale = await seedTask(tx, office, customerId, kevin);
      const fresh = await seedTask(tx, office, customerId, kevin);
      await correctHours(tx, office, stale, 60);

      const outcome = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [ref(stale), ref(fresh)],
      });
      expect(outcome).toMatchObject({ marked: [fresh.number], changed: [stale.number] });
      expect(await readTask(tx, stale.id)).toMatchObject({ status: "completed" });
      expect(await readTask(tx, fresh.id)).toMatchObject({ status: "invoiced" });
    });
  });

  it.each(["open", "assigned", "picked_up", "cancelled"] as const)(
    "does not mark a task that is %s",
    async (status) => {
      await inRolledBackTransaction(async (tx) => {
        const { office, kevin, customerId } = await setUp(tx);
        const task = await seedTask(tx, office, customerId, kevin, status);
        const outcome = await markInvoicedInTransaction(tx, {
          actor: backoffice(office),
          tasks: [ref(task)],
        });
        expect(outcome).toMatchObject({ marked: [], changed: [task.number] });
        expect(await readTask(tx, task.id)).toMatchObject({ status, invoicedAt: null });
      });
    },
  );

  it("reports a number that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office } = await setUp(tx);
      const outcome = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [{ number: 999_999_999, version: "2026-11-25T18:44:00.123456Z" }],
      });
      expect(outcome).toMatchObject({ marked: [], changed: [999_999_999] });
    });
  });

  it("refuses a technician and writes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const outcome = await markInvoicedInTransaction(tx, {
        actor: { id: kevin, role: "technician", isActive: true },
        tasks: [ref(task)],
      });
      expect(outcome).toEqual({ kind: "refused", reason: "wrong_role" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "completed" });
    });
  });

  it("is visible in the overview: the task leaves the tab Afgewerkt and appears under Gefactureerd, with a version", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const completedTab = parseTaskOverviewParams({ status: "completed", technician: kevin });
      const invoicedTab = parseTaskOverviewParams({ status: "invoiced", technician: kevin });

      const before = await queryTaskOverview(tx, completedTab);
      expect(before.rows.map((row) => [row.number, row.version])).toEqual([
        [task.number, task.version],
      ]);
      await markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] });
      expect((await queryTaskOverview(tx, completedTab)).rows).toHaveLength(0);
      expect((await queryTaskOverview(tx, invoicedTab)).rows.map((row) => row.number)).toEqual([
        task.number,
      ]);
    });
  });
});

describe("unmarkInvoicedInTransaction", () => {
  it("takes the mark off: Afgewerkt again, invoiced_at and invoiced_by gone, the hours as they were", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] });
      const invoiced = (await queryTaskDetail(tx, task.number))!;

      const outcome = await unmarkInvoicedInTransaction(tx, {
        actor: backoffice(office),
        number: task.number,
        version: invoiced.version,
      });
      expect(outcome).toEqual({ kind: "unmarked", number: task.number });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "completed",
        invoicedAt: null,
        invoicedBy: null,
        updatedBy: office,
      });
      expect(await readCompletion(tx, task.id)).toMatchObject({ workedMinutes: 120 });
      expect((await queryTaskDetail(tx, task.number))!.version).not.toBe(invoiced.version);
    });
  });

  it("allows marking again after taking the mark off", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] });
      const v2 = (await queryTaskDetail(tx, task.number))!.version;
      await unmarkInvoicedInTransaction(tx, {
        actor: backoffice(office),
        number: task.number,
        version: v2,
      });
      const v3 = (await queryTaskDetail(tx, task.number))!.version;
      const again = await markInvoicedInTransaction(tx, {
        actor: backoffice(office),
        tasks: [{ number: task.number, version: v3 }],
      });
      expect(again).toMatchObject({ marked: [task.number] });
    });
  });

  it("unlocks the hours: they can be corrected after the mark was taken off", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin, "invoiced");
      await unmarkInvoicedInTransaction(tx, {
        actor: backoffice(office),
        number: task.number,
        version: task.version,
      });
      await correctHours(tx, office, task, 75);
      expect(await readCompletion(tx, task.id)).toMatchObject({ correctedMinutes: 75 });
    });
  });

  it("says 'changed' for a task that is not Gefactureerd, and for an old version", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const completed = await seedTask(tx, office, customerId, kevin);
      const invoiced = await seedTask(tx, office, customerId, kevin, "invoiced");
      expect(
        await unmarkInvoicedInTransaction(tx, {
          actor: backoffice(office),
          number: completed.number,
          version: completed.version,
        }),
      ).toEqual({ kind: "changed" });
      expect(
        await unmarkInvoicedInTransaction(tx, {
          actor: backoffice(office),
          number: invoiced.number,
          version: "2020-01-01T00:00:00.000000Z",
        }),
      ).toEqual({ kind: "changed" });
      expect(await readTask(tx, invoiced.id)).toMatchObject({ status: "invoiced" });
    });
  });

  it("says 'not-found' for an unknown number and refuses a technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const invoiced = await seedTask(tx, office, customerId, kevin, "invoiced");
      expect(
        await unmarkInvoicedInTransaction(tx, {
          actor: backoffice(office),
          number: 999_999_999,
          version: invoiced.version,
        }),
      ).toEqual({ kind: "not-found" });
      expect(
        await unmarkInvoicedInTransaction(tx, {
          actor: { id: kevin, role: "technician", isActive: true },
          number: invoiced.number,
          version: invoiced.version,
        }),
      ).toEqual({ kind: "refused", reason: "wrong_role" });
      expect(await readTask(tx, invoiced.id)).toMatchObject({ status: "invoiced" });
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

async function setUpRace(taskCount = 1) {
  await removeTestData();
  const office = await createProfile(db, "Race Office", { role: "backoffice" });
  const kevin = await createProfile(db, "Race Kevin");
  const customerId = await createCustomer(db, office);
  const tasks: Seeded[] = [];
  for (let index = 0; index < taskCount; index++) {
    tasks.push(await seedTask(db, office, customerId, kevin));
  }
  return { office, kevin, tasks };
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

function startMark(office: string, tasks: { number: number; version: string }[]) {
  let finished = false;
  const outcome = connect()
    .transaction((tx) =>
      markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: tasks.map(ref) }),
    )
    .finally(() => (finished = true));
  return { outcome, isFinished: () => finished };
}

describe("markInvoicedInTransaction: other people act at the same moment", () => {
  it("a correction of hours that is under way wins: marking waits and is told 'changed', the corrected hours stay", async () => {
    const { office, tasks } = await setUpRace();
    const [task] = tasks;
    try {
      const correction = holdOpen((tx) => correctHours(tx, office, task, 60));
      await correction.isReady;

      const mark = startMark(office, [task]);
      await sleep(400);
      expect(mark.isFinished()).toBe(false); // It waits for the lock; it does not overwrite.

      correction.release();
      await correction.result;
      expect(await mark.outcome).toMatchObject({ marked: [], changed: [task.number] });
      expect(await readTask(db, task.id)).toMatchObject({ status: "completed", invoicedAt: null });
      expect(await readCompletion(db, task.id)).toMatchObject({ correctedMinutes: 60 });
    } finally {
      await removeTestData();
    }
  });

  it("an edit of the task that is under way wins in the same way", async () => {
    const { office, tasks } = await setUpRace();
    const [task] = tasks;
    try {
      const edit = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ instructions: "Andere klus", updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await edit.isReady;

      const mark = startMark(office, [task]);
      await sleep(400);
      expect(mark.isFinished()).toBe(false);

      edit.release();
      await edit.result;
      expect(await mark.outcome).toMatchObject({ marked: [], changed: [task.number] });
      expect(await readTask(db, task.id)).toMatchObject({ status: "completed" });
    } finally {
      await removeTestData();
    }
  });

  it("a task that is taken back to Toegewezen while marking waits is not marked", async () => {
    const { office, tasks } = await setUpRace();
    const [task] = tasks;
    try {
      const reset = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "assigned", pickedUpAt: null, updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await reset.isReady;

      const mark = startMark(office, [task]);
      await sleep(400);
      expect(mark.isFinished()).toBe(false);

      reset.release();
      await reset.result;
      expect(await mark.outcome).toMatchObject({ marked: [], changed: [task.number] });
      expect(await readTask(db, task.id)).toMatchObject({ status: "assigned", invoicedAt: null });
    } finally {
      await removeTestData();
    }
  });

  it("marking that is under way wins over a correction: the hours that are invoiced cannot change", async () => {
    const { office, tasks } = await setUpRace();
    const [task] = tasks;
    try {
      const mark = holdOpen((tx) =>
        markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] }),
      );
      await mark.isReady;

      // A correction as BT-15 will do it: lock, then only when still Afgewerkt.
      let finished = false;
      const correction = connect()
        .transaction(async (tx) => {
          const [locked] = await tx
            .select({ status: schema.tasks.status })
            .from(schema.tasks)
            .where(eq(schema.tasks.id, task.id))
            .for("update");
          if (locked.status === "completed") {
            await correctHours(tx, office, task, 30);
          }
          return locked.status;
        })
        .finally(() => (finished = true));
      await sleep(400);
      expect(finished).toBe(false);

      mark.release();
      expect(await mark.result).toMatchObject({ marked: [task.number] });
      expect(await correction).toBe("invoiced");
      expect(await readCompletion(db, task.id)).toMatchObject({ correctedMinutes: null });
    } finally {
      await removeTestData();
    }
  });

  it("marking the same selection twice at the same moment marks each task once", async () => {
    const { office, tasks } = await setUpRace(3);
    try {
      const [first, second] = await Promise.all([
        startMark(office, tasks).outcome,
        startMark(office, tasks).outcome,
      ]);
      const numbers = tasks.map((task) => task.number).sort((a, b) => a - b);
      const outcomes = [first, second].map((outcome) => {
        if (outcome.kind !== "done") {
          throw new Error("refused");
        }
        return outcome;
      });
      // One of them did all the work, the other found everything done.
      const winner = outcomes.find((outcome) => outcome.marked.length > 0)!;
      const loser = outcomes.find((outcome) => outcome !== winner)!;
      expect(winner.marked).toEqual(numbers);
      expect(winner.alreadyInvoiced).toEqual([]);
      expect(loser.marked).toEqual([]);
      expect(loser.alreadyInvoiced).toEqual(numbers);
      const rows = await Promise.all(tasks.map((task) => readTask(db, task.id)));
      expect(rows.every((row) => row.status === "invoiced")).toBe(true);
      expect(new Set(rows.map((row) => row.invoicedAt!.getTime())).size).toBe(1);
    } finally {
      await removeTestData();
    }
  });

  it("selections that overlap, in opposite orders, never deadlock", async () => {
    for (let round = 0; round < 5; round++) {
      const { office, tasks } = await setUpRace(6);
      try {
        const forward = tasks;
        const backward = [...tasks].reverse();
        const results = await Promise.all([
          startMark(office, forward.slice(0, 4)).outcome,
          startMark(office, backward.slice(0, 4)).outcome,
          startMark(office, backward).outcome,
          startMark(office, forward).outcome,
        ]);
        expect(results.every((result) => result.kind === "done")).toBe(true);
        const marked = results.flatMap((result) => (result.kind === "done" ? result.marked : []));
        // Every task was marked by exactly one of them.
        expect(marked.sort((a, b) => a - b)).toEqual(
          tasks.map((task) => task.number).sort((a, b) => a - b),
        );
      } finally {
        await removeTestData();
      }
    }
  });

  it("taking the mark off while marking waits: marking is told 'changed' and the task stays Afgewerkt", async () => {
    const { office, tasks } = await setUpRace();
    const [task] = tasks;
    try {
      await markInvoicedInTransaction(db, { actor: backoffice(office), tasks: [ref(task)] });
      const invoiced = (await queryTaskDetail(db, task.number))!;
      const unmark = holdOpen((tx) =>
        unmarkInvoicedInTransaction(tx, {
          actor: backoffice(office),
          number: task.number,
          version: invoiced.version,
        }),
      );
      await unmark.isReady;

      // A second window still shows the task as Afgewerkt (the page of before the first mark).
      const mark = startMark(office, [task]);
      await sleep(400);
      expect(mark.isFinished()).toBe(false);

      unmark.release();
      expect(await unmark.result).toEqual({ kind: "unmarked", number: task.number });
      expect(await mark.outcome).toMatchObject({ marked: [], changed: [task.number] });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "completed",
        invoicedAt: null,
        invoicedBy: null,
      });
    } finally {
      await removeTestData();
    }
  });

  it("taking the mark off twice at the same moment works once", async () => {
    const { office, tasks } = await setUpRace();
    const [task] = tasks;
    try {
      await markInvoicedInTransaction(db, { actor: backoffice(office), tasks: [ref(task)] });
      const invoiced = (await queryTaskDetail(db, task.number))!;
      const unmark = () =>
        connect().transaction((tx) =>
          unmarkInvoicedInTransaction(tx, {
            actor: backoffice(office),
            number: task.number,
            version: invoiced.version,
          }),
        );
      const results = await Promise.all([unmark(), unmark()]);
      expect(results.map((result) => result.kind).sort()).toEqual(["changed", "unmarked"]);
      expect(await readTask(db, task.id)).toMatchObject({ status: "completed" });
    } finally {
      await removeTestData();
    }
  });
});
