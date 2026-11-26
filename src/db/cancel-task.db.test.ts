import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { cancelTaskInTransaction } from "@/lib/tasks/cancel";
import { completeTaskInTransaction } from "@/lib/tasks/complete";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { markInvoicedInTransaction } from "@/lib/tasks/invoice";
import { pickUpTaskInTransaction } from "@/lib/tasks/pick-up";
import { resetTaskInTransaction } from "@/lib/tasks/reset";
import { updateTaskInTransaction } from "@/lib/tasks/update";
import type { UpdateTaskData } from "@/lib/validation/update-task";

// "Taak annuleren" (BT-14b) against the real database (local Supabase in CI): what is saved,
// every refusal, and what happens when the technician picks up, or a colleague edits, resets or
// invoices, at the same moment. The first group runs in a transaction that is always rolled
// back. The races need two connections that see each other's locks, so their data is committed
// and removed again afterwards.
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

const emailSuffix = "@cancel-test.example";

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
  spec: { status?: Status; assignee: string | null; pickedUpAt?: string },
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
      ${["picked_up", "completed", "invoiced"].includes(status) ? (spec.pickedUpAt ?? stamp) : null},
      ${status === "invoiced" ? stamp : null}, ${status === "invoiced" ? office : null},
      ${status === "cancelled" ? stamp : null}, ${status === "cancelled" ? office : null},
      ${office}, ${office}
    ) returning id, number
  `);
  const detail = await queryTaskDetail(tx, task.number);
  return { id: task.id, number: task.number, version: detail!.version };
}

async function completionsOf(tx: Pick<Db, "select">, taskId: string) {
  return tx.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, taskId));
}

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string) {
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, created_by) values ('Annuleer-testklant', ${createdBy})
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

const office = (id: string) => ({ id, role: "backoffice" as const, isActive: true });

/** What the edit form sends for a task of this customer (the fields do not matter, the status does). */
function edit(
  task: { number: number; version: string },
  customerId: string,
  assigneeId: string | null,
): UpdateTaskData {
  return {
    number: task.number,
    version: task.version,
    customer: { kind: "existing", id: customerId },
    location: {
      locationStreet: "Nieuwstraat 5",
      locationPostalCode: "9000",
      locationCity: "Gent",
    },
    workType: "repair",
    instructions: "Aangepast",
    scheduledDate: "2030-04-01",
    startTime: "09:30",
    estimatedMinutes: 90,
    assigneeId,
  };
}

/** What the dialog sends, for a task in the state of the page that was opened. */
const cancel = (
  task: { number: number; version: string },
  reason: string | null = "Klant heeft zelf afgezegd",
) => ({ number: task.number, version: task.version, reason });

/** The database clock, to see that the time of cancelling is "now" and not a time from the form. */
async function databaseNow(tx: Pick<Db, "execute">): Promise<Date> {
  const [row] = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(row.now);
}

describe("cancelTaskInTransaction", () => {
  it("cancels a Toegewezen task: who, when (database clock) and why; the technician stays on it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { status: "assigned", assignee: kevin });
      const before = await databaseNow(tx);

      const outcome = await cancelTaskInTransaction(tx, {
        actor: office(sofie),
        data: cancel(task),
      });
      const after = await databaseNow(tx);

      expect(outcome).toEqual({ kind: "cancelled", id: task.id, number: task.number });
      const saved = await readTask(tx, task.id);
      expect(saved).toMatchObject({
        status: "cancelled",
        cancelledBy: sofie,
        cancellationReason: "Klant heeft zelf afgezegd",
        assigneeId: kevin,
        pickedUpAt: null,
        updatedBy: sofie,
        // Nothing else of the task changes.
        instructions: "Onderhoud",
        locationCity: "Turnhout",
        scheduledDate: "2030-03-15",
        createdBy: sofie,
      });
      expect(saved.cancelledAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(saved.cancelledAt!.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(await completionsOf(tx, task.id)).toHaveLength(0);
    });
  });

  it("cancels an Open task without a reason", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { status: "open", assignee: null });

      expect(
        await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task, null) }),
      ).toMatchObject({ kind: "cancelled" });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "cancelled",
        assigneeId: null,
        cancelledBy: sofie,
        cancellationReason: null,
      });
    });
  });

  it("keeps a reason of 500 characters with line breaks and special characters as it was", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { status: "open", assignee: null });
      const reason = `Zaak "café" & <b>klant</b>\n${"é".repeat(470)}`.slice(0, 500);

      await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task, reason) });
      expect((await readTask(tx, task.id)).cancellationReason).toBe(reason);
    });
  });

  it("moves the version (updated_at) with the database trigger, so an old page is recognised", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });
      await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) });
      expect((await queryTaskDetail(tx, task.number))!.version).not.toBe(task.version);
    });
  });

  it("is shown as cancelled to the technician of the task (T2), and he cannot pick it up or finish it any more", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });
      await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) });
      const fresh = (await queryTaskDetail(tx, task.number))!.version;

      expect(await queryTaskDetail(tx, task.number, { assigneeId: kevin })).toMatchObject({
        status: "cancelled",
        cancellationReason: "Klant heeft zelf afgezegd",
      });
      // Both with the old page and with a fresh one.
      for (const version of [task.version, fresh]) {
        expect(
          await pickUpTaskInTransaction(tx, {
            actor: technician(kevin),
            number: task.number,
            version,
          }),
        ).toEqual({ kind: "cancelled" });
      }
      expect((await readTask(tx, task.id)).status).toBe("cancelled");
      expect((await readTask(tx, task.id)).pickedUpAt).toBeNull();
    });
  });

  it("cannot be edited afterwards, with the old page or a fresh one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });
      await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) });
      const fresh = (await queryTaskDetail(tx, task.number))!.version;
      const saved = await readTask(tx, task.id);

      for (const version of [task.version, fresh]) {
        expect(
          await updateTaskInTransaction(tx, {
            actor: office(sofie),
            data: edit({ number: task.number, version }, customerId, kevin),
          }),
        ).toEqual({ kind: "not-editable", status: "cancelled" });
      }
      expect(await readTask(tx, task.id)).toEqual(saved);
    });
  });

  it("cannot be reset or cancelled again afterwards", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });
      await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) });
      const fresh = {
        number: task.number,
        version: (await queryTaskDetail(tx, task.number))!.version,
      };
      const saved = await readTask(tx, task.id);

      expect(
        await resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: {
            ...fresh,
            assigneeId: kevin,
            scheduledDate: "2030-04-02",
            startTime: "08:00",
          },
        }),
      ).toEqual({ kind: "changed" });
      expect(
        await cancelTaskInTransaction(tx, {
          actor: office(sofie),
          data: cancel(fresh, "Andere reden"),
        }),
      ).toEqual({ kind: "changed" });
      expect(await readTask(tx, task.id)).toEqual(saved);
    });
  });

  it("refuses a number that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie } = await setUp(tx);
      expect(
        await cancelTaskInTransaction(tx, {
          actor: office(sofie),
          data: cancel({ number: 2147483000, version: "2026-11-25T18:44:00.123456Z" }),
        }),
      ).toEqual({ kind: "not-found" });
    });
  });

  it("refuses an Opgepikt task with the name of the technician, and writes nothing (first Terugzetten)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { status: "picked_up", assignee: kevin });
      const before = await readTask(tx, task.id);

      expect(
        await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      ).toEqual({ kind: "picked-up", technicianName: "Kevin Wouters" });
      expect(await readTask(tx, task.id)).toEqual(before);
    });
  });

  it.each(["completed", "invoiced", "cancelled"] as const)(
    "refuses a %s task as 'changed' and writes nothing",
    async (status) => {
      await inRolledBackTransaction(async (tx) => {
        const { office: sofie, kevin, customerId } = await setUp(tx);
        const task = await seedTask(tx, sofie, customerId, { status, assignee: kevin });
        const before = await readTask(tx, task.id);

        expect(
          await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
        ).toEqual({ kind: "changed" });
        expect(await readTask(tx, task.id)).toEqual(before);
      });
    },
  );

  it("leaves the hours report of a finished task alone", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { status: "picked_up", assignee: kevin });
      await completeTaskInTransaction(tx, {
        actor: technician(kevin),
        number: task.number,
        version: task.version,
        workedMinutes: 90,
        notes: null,
      });
      const fresh = (await queryTaskDetail(tx, task.number))!.version;

      expect(
        await cancelTaskInTransaction(tx, {
          actor: office(sofie),
          data: cancel({ number: task.number, version: fresh }),
        }),
      ).toEqual({ kind: "changed" });
      expect(await completionsOf(tx, task.id)).toHaveLength(1);
      expect((await readTask(tx, task.id)).status).toBe("completed");
    });
  });

  it("refuses when the task was edited after the page was opened (the version)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });
      await tx
        .update(schema.tasks)
        .set({ instructions: "Andere instructies", updatedBy: sofie })
        .where(eq(schema.tasks.id, task.id));

      expect(
        await cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      ).toEqual({ kind: "changed" });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "assigned",
        instructions: "Andere instructies",
        cancelledAt: null,
        cancelledBy: null,
      });
    });
  });

  it("refuses a technician as the actor (only the back office cancels) and an inactive user", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });

      expect(
        await cancelTaskInTransaction(tx, { actor: technician(kevin), data: cancel(task) }),
      ).toEqual({ kind: "refused", reason: "wrong_role" });
      expect(
        await cancelTaskInTransaction(tx, {
          actor: { ...office(sofie), isActive: false },
          data: cancel(task),
        }),
      ).toEqual({ kind: "refused", reason: "actor_inactive" });
      expect((await readTask(tx, task.id)).status).toBe("assigned");
    });
  });

  it("the database refuses a reason of more than 500 characters (the Zod limit is not the only one)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, sofie, customerId, { assignee: kevin });
      await expect(
        tx.transaction((inner) =>
          cancelTaskInTransaction(inner, {
            actor: office(sofie),
            data: cancel(task, "x".repeat(501)),
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
    delete from public.task_completions where task_id in
      (select id from public.tasks where created_by in
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

async function setUpRace(status: Status = "assigned") {
  await removeTestData();
  const sofie = await createProfile(db, "Race Office", { role: "backoffice" });
  const kevin = await createProfile(db, "Race Kevin");
  const jens = await createProfile(db, "Race Jens");
  const customerId = await createCustomer(db, sofie);
  const task = await seedTask(db, sofie, customerId, { status, assignee: kevin });
  return { sofie, kevin, jens, customerId, task };
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

/** Starts work on its own connection and reports whether it is still waiting. */
function start<T>(work: (tx: Tx) => Promise<T>) {
  let finished = false;
  const outcome = connect()
    .transaction(work)
    .finally(() => (finished = true));
  return { outcome, isFinished: () => finished };
}

describe("cancelTaskInTransaction: the technician acts at the same moment", () => {
  it("a pick-up that is under way wins: the cancellation waits and is told to call the technician, the task stays Opgepikt", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const pickingUp = holdOpen((tx) =>
        pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
      );
      await pickingUp.isReady;

      const cancelling = start((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await sleep(400);
      expect(cancelling.isFinished()).toBe(false); // Waits for the lock on the task.

      pickingUp.release();
      expect(await pickingUp.result).toMatchObject({ kind: "picked-up" });
      expect(await cancelling.outcome).toEqual({
        kind: "picked-up",
        technicianName: "Race Kevin",
      });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "picked_up",
        assigneeId: kevin,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
      });
    } finally {
      await removeTestData();
    }
  });

  it("a cancellation that is under way wins: the pick-up waits and is told the task is cancelled, nothing is picked up", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const cancelling = holdOpen((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await cancelling.isReady;

      const pickingUp = start((tx) =>
        pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
      );
      await sleep(400);
      expect(pickingUp.isFinished()).toBe(false);

      cancelling.release();
      expect(await cancelling.result).toMatchObject({ kind: "cancelled" });
      expect(await pickingUp.outcome).toEqual({ kind: "cancelled" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "cancelled",
        pickedUpAt: null,
        assigneeId: kevin,
        cancellationReason: "Klant heeft zelf afgezegd",
      });
    } finally {
      await removeTestData();
    }
  });

  it("a cancellation that is under way wins: a finish on an old page waits and is told the task is cancelled", async () => {
    // Not possible with a real Opgepikt task (that cannot be cancelled), but a technician with an
    // old T3 page for a task that was reset and then cancelled must not save hours.
    const { sofie, kevin, task } = await setUpRace();
    try {
      const cancelling = holdOpen((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await cancelling.isReady;

      const completing = start((tx) =>
        completeTaskInTransaction(tx, {
          actor: technician(kevin),
          number: task.number,
          version: task.version,
          workedMinutes: 90,
          notes: null,
        }),
      );
      await sleep(400);
      expect(completing.isFinished()).toBe(false);

      cancelling.release();
      await cancelling.result;
      expect(await completing.outcome).toEqual({ kind: "cancelled" });
      expect(await completionsOf(db, task.id)).toHaveLength(0);
    } finally {
      await removeTestData();
    }
  });
});

describe("cancelTaskInTransaction: a colleague acts at the same moment", () => {
  it("an edit that is under way wins: the cancellation waits and is told 'changed', the edit stays", async () => {
    const { sofie, task } = await setUpRace();
    try {
      const edit = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ instructions: "Andere klus", updatedBy: sofie })
          .where(eq(schema.tasks.id, task.id));
      });
      await edit.isReady;

      const cancelling = start((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await sleep(400);
      expect(cancelling.isFinished()).toBe(false);

      edit.release();
      await edit.result;
      expect(await cancelling.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "assigned",
        instructions: "Andere klus",
      });
    } finally {
      await removeTestData();
    }
  });

  it("a cancellation that is under way wins: an edit of the page that is open waits and is told the task is cancelled", async () => {
    const { sofie, kevin, customerId, task } = await setUpRace();
    try {
      const cancelling = holdOpen((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await cancelling.isReady;

      const editing = start((tx) =>
        updateTaskInTransaction(tx, { actor: office(sofie), data: edit(task, customerId, kevin) }),
      );
      await sleep(400);
      expect(editing.isFinished()).toBe(false);

      cancelling.release();
      await cancelling.result;
      expect(await editing.outcome).toEqual({ kind: "not-editable", status: "cancelled" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "cancelled",
        instructions: "Onderhoud",
      });
    } finally {
      await removeTestData();
    }
  });

  it("a reset that is under way wins: the cancellation (page from before the pick-up) waits and is told 'changed'", async () => {
    const { sofie, kevin, task } = await setUpRace("picked_up");
    try {
      const resetting = holdOpen((tx) =>
        resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: {
            number: task.number,
            version: task.version,
            assigneeId: kevin,
            scheduledDate: "2030-04-02",
            startTime: "08:00",
          },
        }),
      );
      await resetting.isReady;

      // The page of the cancellation was opened when the task was Toegewezen, before it was picked up.
      const cancelling = start((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await sleep(400);
      expect(cancelling.isFinished()).toBe(false);

      resetting.release();
      expect(await resetting.result).toMatchObject({ kind: "reset" });
      expect(await cancelling.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "assigned",
        scheduledDate: "2030-04-02",
        cancelledAt: null,
      });
    } finally {
      await removeTestData();
    }
  });

  it("a cancellation that is under way wins: a reset of the same task is told 'changed'", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const cancelling = holdOpen((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await cancelling.isReady;

      const resetting = start((tx) =>
        resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: {
            number: task.number,
            version: task.version,
            assigneeId: kevin,
            scheduledDate: "2030-04-02",
            startTime: "08:00",
          },
        }),
      );
      await sleep(400);
      expect(resetting.isFinished()).toBe(false);

      cancelling.release();
      await cancelling.result;
      expect(await resetting.outcome).toEqual({ kind: "changed" });
      expect((await readTask(db, task.id)).status).toBe("cancelled");
    } finally {
      await removeTestData();
    }
  });

  it("an invoicing that is under way on a finished task wins: the cancellation waits and is told 'changed'", async () => {
    const { sofie, task } = await setUpRace("completed");
    try {
      const invoicing = holdOpen((tx) =>
        markInvoicedInTransaction(tx, {
          actor: office(sofie),
          tasks: [{ number: task.number, version: task.version }],
        }),
      );
      await invoicing.isReady;

      const cancelling = start((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task) }),
      );
      await sleep(400);
      expect(cancelling.isFinished()).toBe(false);

      invoicing.release();
      expect(await invoicing.result).toMatchObject({ kind: "done", marked: [task.number] });
      expect(await cancelling.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "invoiced", cancelledAt: null });
    } finally {
      await removeTestData();
    }
  });

  it("two cancellations of the same task: one wins, the other is told 'changed' and the first reason stays", async () => {
    const { sofie, task } = await setUpRace();
    try {
      const first = holdOpen((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task, "Eerste reden") }),
      );
      await first.isReady;

      const second = start((tx) =>
        cancelTaskInTransaction(tx, { actor: office(sofie), data: cancel(task, "Tweede reden") }),
      );
      await sleep(400);
      expect(second.isFinished()).toBe(false);

      first.release();
      expect(await first.result).toMatchObject({ kind: "cancelled" });
      expect(await second.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "cancelled",
        cancellationReason: "Eerste reden",
      });
    } finally {
      await removeTestData();
    }
  });
});
