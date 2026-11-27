import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { correctHoursInTransaction } from "@/lib/tasks/correct-hours";
import { markInvoicedInTransaction, unmarkInvoicedInTransaction } from "@/lib/tasks/invoice";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { queryTaskOverview } from "@/lib/tasks/overview";
import { parseTaskOverviewParams } from "@/lib/validation/task-overview";

// "Uren corrigeren" (BT-15) against the real database (local Supabase in CI): what is saved, every
// refusal, a correction twice, and what happens when "Markeer als gefactureerd" (BT-17), an edit
// or a second correction happen at the same moment. The first group runs in a transaction that is
// always rolled back. The races need two connections that see each other's locks, so their data
// is committed and removed again afterwards.
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

const emailSuffix = "@correct-test.example";

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
    insert into public.customers (name, created_by) values ('Correctie-testklant', ${createdBy})
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

function correct(
  tx: Parameters<typeof correctHoursInTransaction>[0],
  office: string,
  task: { number: number; version: string },
  correctedMinutes = 90,
  reason = "Pauze niet afgetrokken",
) {
  return correctHoursInTransaction(tx, {
    actor: backoffice(office),
    data: { number: task.number, version: task.version, correctedMinutes, reason },
  });
}

async function setUp(tx: Tx | Db) {
  const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
  const kevin = await createProfile(tx, "Kevin Wouters");
  const customerId = await createCustomer(tx, office);
  return { office, kevin, customerId };
}

describe("correctHoursInTransaction", () => {
  it("writes the correction next to the original hours, with the reason, who and when", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const other = await seedTask(tx, office, customerId, kevin);
      const [before] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      const outcome = await correct(tx, office, task, 90, "Pauze niet afgetrokken");
      const [after] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      expect(outcome).toEqual({
        kind: "corrected",
        id: task.id,
        number: task.number,
        correctedMinutes: 90,
      });
      const completion = await readCompletion(tx, task.id);
      expect(completion).toMatchObject({
        workedMinutes: 120, // A19: the technician's hours stay.
        correctedMinutes: 90,
        correctionReason: "Pauze niet afgetrokken",
        correctedBy: office,
        completedBy: kevin,
      });
      expect(completion.correctedAt!.getTime()).toBeGreaterThanOrEqual(Math.floor(before.now));
      expect(completion.correctedAt!.getTime()).toBeLessThanOrEqual(Math.ceil(after.now));
      expect(await readTask(tx, task.id)).toMatchObject({ status: "completed", updatedBy: office });
      // Another task is left alone.
      expect(await readCompletion(tx, other.id)).toMatchObject({ correctedMinutes: null });
    });
  });

  it("moves the version of the task (ADR-0003), also when the same user wrote it last", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin); // updated_by is the office already
      await correct(tx, office, task);
      const detail = (await queryTaskDetail(tx, task.number))!;
      expect(detail.version).not.toBe(task.version);
      expect(detail.completion).toMatchObject({
        workedMinutes: 120,
        correctedMinutes: 90,
        correctionReason: "Pauze niet afgetrokken",
        correctedByName: "Sofie Peeters",
      });
    });
  });

  it("is visible in the overview as the hours that count, marked as corrected", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const tab = parseTaskOverviewParams({ status: "completed", technician: kevin });
      expect((await queryTaskOverview(tx, tab)).rows[0]).toMatchObject({
        minutes: 120,
        corrected: false,
      });
      await correct(tx, office, task, 45);
      const [row] = (await queryTaskOverview(tx, tab)).rows;
      expect(row).toMatchObject({ number: task.number, minutes: 45, corrected: true });
      expect(row.version).not.toBe(task.version);
    });
  });

  it("corrects a second time with the fresh version: the second correction replaces the first, the original stays", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await correct(tx, office, task, 90, "Eerste reden");
      const fresh = (await queryTaskDetail(tx, task.number))!;
      expect(await correct(tx, office, fresh, 60, "Tweede reden")).toMatchObject({
        kind: "corrected",
      });
      expect(await readCompletion(tx, task.id)).toMatchObject({
        workedMinutes: 120,
        correctedMinutes: 60,
        correctionReason: "Tweede reden",
      });
    });
  });

  it("a second correction from the same page is 'changed' and the first one stays", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await correct(tx, office, task, 90, "Eerste reden");
      expect(await correct(tx, office, task, 60, "Tweede reden")).toEqual({ kind: "changed" });
      expect(await readCompletion(tx, task.id)).toMatchObject({
        correctedMinutes: 90,
        correctionReason: "Eerste reden",
      });
    });
  });

  it("is 'changed' when the task was edited after the page was opened", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await tx
        .update(schema.tasks)
        .set({ instructions: "Andere klus", updatedBy: office })
        .where(eq(schema.tasks.id, task.id));
      expect(await correct(tx, office, task)).toEqual({ kind: "changed" });
      expect(await readCompletion(tx, task.id)).toMatchObject({ correctedMinutes: null });
    });
  });

  it("refuses a Gefactureerd task: the hours are locked, whatever the version", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin, "invoiced");
      expect(await correct(tx, office, task)).toEqual({ kind: "invoiced" });
      expect(
        await correct(tx, office, { ...task, version: "2020-01-01T00:00:00.000000Z" }),
      ).toEqual({
        kind: "invoiced",
      });
      expect(await readCompletion(tx, task.id)).toMatchObject({
        workedMinutes: 120,
        correctedMinutes: null,
        correctionReason: null,
        correctedBy: null,
        correctedAt: null,
      });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "invoiced" });
      expect((await queryTaskDetail(tx, task.number))!.version).toBe(task.version);
    });
  });

  it("unlocks after 'Markering ongedaan maken', but not for a page from before", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] });
      const invoiced = (await queryTaskDetail(tx, task.number))!;
      expect(await correct(tx, office, invoiced)).toEqual({ kind: "invoiced" });
      await unmarkInvoicedInTransaction(tx, {
        actor: backoffice(office),
        number: task.number,
        version: invoiced.version,
      });
      // The page from before marking has an old version.
      expect(await correct(tx, office, task)).toEqual({ kind: "changed" });
      const fresh = (await queryTaskDetail(tx, task.number))!;
      expect(await correct(tx, office, fresh, 75)).toMatchObject({ kind: "corrected" });
      expect(await readCompletion(tx, task.id)).toMatchObject({ correctedMinutes: 75 });
    });
  });

  it.each(["open", "assigned", "picked_up", "cancelled"] as const)(
    "says 'changed' for a %s task and writes nothing",
    async (status) => {
      await inRolledBackTransaction(async (tx) => {
        const { office, kevin, customerId } = await setUp(tx);
        const task = await seedTask(tx, office, customerId, kevin, status);
        expect(await correct(tx, office, task)).toEqual({ kind: "changed" });
        expect(await readTask(tx, task.id)).toMatchObject({ status });
        expect(await readCompletion(tx, task.id)).toBeUndefined();
      });
    },
  );

  it("says 'not-found' for a number that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office } = await setUp(tx);
      expect(
        await correct(tx, office, { number: 999_999_999, version: "2026-11-25T18:44:00.123456Z" }),
      ).toEqual({ kind: "not-found" });
    });
  });

  it("refuses a technician, and hours or a reason that the rules do not accept, and writes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      expect(
        await correctHoursInTransaction(tx, {
          actor: { id: kevin, role: "technician", isActive: true },
          data: { ...ref(task), correctedMinutes: 90, reason: "Zelf" },
        }),
      ).toEqual({ kind: "refused", reason: "wrong_role" });
      expect(await correct(tx, office, task, 7)).toEqual({
        kind: "refused",
        reason: "hours_invalid",
      });
      expect(await correct(tx, office, task, 90, "   ")).toEqual({
        kind: "refused",
        reason: "reason_required",
      });
      expect(await readCompletion(tx, task.id)).toMatchObject({ correctedMinutes: null });
      expect((await queryTaskDetail(tx, task.number))!.version).toBe(task.version);
    });
  });

  it("rolls back completely when the task has no completion row", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await tx.delete(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, task.id));
      // A savepoint: the failure must not poison the surrounding test transaction.
      await expect(tx.transaction((inner) => correct(inner, office, task))).rejects.toThrow(
        "no completion",
      );
      expect((await queryTaskDetail(tx, task.number))!.version).toBe(task.version);
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
  const customerId = await createCustomer(db, office);
  const task: Seeded = await seedTask(db, office, customerId, kevin);
  return { office, kevin, task };
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

function start<T>(work: (tx: Tx) => Promise<T>) {
  let finished = false;
  const outcome = connect()
    .transaction(work)
    .finally(() => (finished = true));
  return { outcome, isFinished: () => finished };
}

describe("correctHoursInTransaction: 'Markeer als gefactureerd' and others at the same moment", () => {
  it("a correction made after the list was opened: marking with the old version reports the task as changed (BT-17 acceptance)", async () => {
    const { office, task } = await setUpRace();
    try {
      // The list is open with `task.version`. Meanwhile a correction is committed.
      expect(
        await db.transaction((tx) => correct(tx, office, task, 60, "Sleutel niet aanrekenen")),
      ).toMatchObject({ kind: "corrected" });
      const outcome = await db.transaction((tx) =>
        markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] }),
      );
      expect(outcome).toMatchObject({ kind: "done", marked: [], changed: [task.number] });
      expect(await readTask(db, task.id)).toMatchObject({ status: "completed", invoicedAt: null });
      expect(await readCompletion(db, task.id)).toMatchObject({ correctedMinutes: 60 });
    } finally {
      await removeTestData();
    }
  });

  it("a correction that is under way wins: marking waits and is told 'changed', the corrected hours stay", async () => {
    const { office, task } = await setUpRace();
    try {
      const correction = holdOpen((tx) => correct(tx, office, task, 60));
      await correction.isReady;

      const mark = start((tx) =>
        markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] }),
      );
      await sleep(400);
      expect(mark.isFinished()).toBe(false); // It waits for the lock; it does not overwrite.

      correction.release();
      expect(await correction.result).toMatchObject({ kind: "corrected" });
      expect(await mark.outcome).toMatchObject({ marked: [], changed: [task.number] });
      expect(await readTask(db, task.id)).toMatchObject({ status: "completed", invoicedAt: null });
      expect(await readCompletion(db, task.id)).toMatchObject({ correctedMinutes: 60 });
    } finally {
      await removeTestData();
    }
  });

  it("marking that is under way wins: the correction waits, is told 'invoiced', and the invoiced hours do not change", async () => {
    const { office, task } = await setUpRace();
    try {
      const mark = holdOpen((tx) =>
        markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] }),
      );
      await mark.isReady;

      const correction = start((tx) => correct(tx, office, task, 30));
      await sleep(400);
      expect(correction.isFinished()).toBe(false);

      mark.release();
      expect(await mark.result).toMatchObject({ marked: [task.number] });
      expect(await correction.outcome).toEqual({ kind: "invoiced" });
      expect(await readCompletion(db, task.id)).toMatchObject({
        workedMinutes: 120,
        correctedMinutes: null,
      });
      expect(await readTask(db, task.id)).toMatchObject({ status: "invoiced" });
    } finally {
      await removeTestData();
    }
  });

  it("two corrections from the same page at the same moment: one wins, the other is 'changed' and the first stays", async () => {
    const { office, task } = await setUpRace();
    try {
      const first = holdOpen((tx) => correct(tx, office, task, 90, "Eerste"));
      await first.isReady;
      const second = start((tx) => correct(tx, office, task, 45, "Tweede"));
      await sleep(400);
      expect(second.isFinished()).toBe(false);

      first.release();
      expect(await first.result).toMatchObject({ kind: "corrected" });
      expect(await second.outcome).toEqual({ kind: "changed" });
      expect(await readCompletion(db, task.id)).toMatchObject({
        correctedMinutes: 90,
        correctionReason: "Eerste",
      });
    } finally {
      await removeTestData();
    }
  });

  it("an edit that is under way wins: the correction waits and is told 'changed', the edit stays", async () => {
    const { office, task } = await setUpRace();
    try {
      const edit = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ instructions: "Andere klus", updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await edit.isReady;
      const correction = start((tx) => correct(tx, office, task));
      await sleep(400);
      expect(correction.isFinished()).toBe(false);

      edit.release();
      await edit.result;
      expect(await correction.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ instructions: "Andere klus" });
      expect(await readCompletion(db, task.id)).toMatchObject({ correctedMinutes: null });
    } finally {
      await removeTestData();
    }
  });

  it("taking the mark off while a correction waits: the correction with the invoiced version is allowed, a page from before is not", async () => {
    const { office, task } = await setUpRace();
    try {
      await db.transaction((tx) =>
        markInvoicedInTransaction(tx, { actor: backoffice(office), tasks: [ref(task)] }),
      );
      const invoiced = (await queryTaskDetail(db, task.number))!;

      const unmark = holdOpen((tx) =>
        unmarkInvoicedInTransaction(tx, {
          actor: backoffice(office),
          number: task.number,
          version: invoiced.version,
        }),
      );
      await unmark.isReady;
      const stale = start((tx) => correct(tx, office, task, 30));
      await sleep(400);
      expect(stale.isFinished()).toBe(false);

      unmark.release();
      expect(await unmark.result).toMatchObject({ kind: "unmarked" });
      // The page from before marking has an old version: refused, nothing is overwritten.
      expect(await stale.outcome).toEqual({ kind: "changed" });
      expect(await readCompletion(db, task.id)).toMatchObject({ correctedMinutes: null });
    } finally {
      await removeTestData();
    }
  });
});
