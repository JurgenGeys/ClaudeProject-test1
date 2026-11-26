import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { pickUpTaskInTransaction } from "@/lib/tasks/pick-up";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";

// "Taak oppikken" (BT-12) against the real database (local Supabase in CI): what is saved, every
// refusal, a second task picked up next to the first (K5), and what happens when the office
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

const emailSuffix = "@pick-up-test.example";

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

type Status = "open" | "assigned" | "picked_up" | "completed" | "cancelled";

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
      scheduled_date, start_time, assignee_id, status, picked_up_at, cancelled_at, cancelled_by,
      created_by, updated_by
    ) values (
      ${customerId}, 'Straat 1', '2300', 'Turnhout', 'maintenance', 'Onderhoud',
      '2030-03-15', '09:00', ${spec.assignee}, ${status},
      ${["picked_up", "completed"].includes(status) ? stamp : null},
      ${status === "cancelled" ? stamp : null}, ${status === "cancelled" ? office : null},
      ${office}, ${office}
    ) returning id, number
  `);
  const detail = await queryTaskDetail(tx, task.number);
  return { id: task.id, number: task.number, version: detail!.version };
}

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string) {
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, created_by) values ('Oppik-testklant', ${createdBy})
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

describe("pickUpTaskInTransaction", () => {
  it("makes the task Opgepikt with the time of the database and the technician as updater", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { assignee: kevin });
      const [before] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      const outcome = await pickUpTaskInTransaction(tx, {
        actor: technician(kevin),
        number: task.number,
        version: task.version,
      });
      const [after] = await tx.execute<{ now: number }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
      );

      expect(outcome).toMatchObject({ kind: "picked-up", id: task.id, number: task.number });
      const row = await readTask(tx, task.id);
      expect(row).toMatchObject({ status: "picked_up", assigneeId: kevin, updatedBy: kevin });
      expect(row.pickedUpAt!.getTime()).toBeGreaterThanOrEqual(Math.floor(before.now));
      expect(row.pickedUpAt!.getTime()).toBeLessThanOrEqual(Math.ceil(after.now));
      // The trigger of ADR-0003 moved the version.
      expect((await queryTaskDetail(tx, task.number))!.version).not.toBe(task.version);
    });
  });

  it("lets a technician pick up a second task while the first one is picked up (K5)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const first = await seedTask(tx, office, customerId, { assignee: kevin });
      const second = await seedTask(tx, office, customerId, { assignee: kevin });

      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(kevin),
          number: first.number,
          version: first.version,
        }),
      ).toMatchObject({ kind: "picked-up" });
      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(kevin),
          number: second.number,
          version: second.version,
        }),
      ).toMatchObject({ kind: "picked-up" });

      expect((await readTask(tx, first.id)).status).toBe("picked_up");
      expect((await readTask(tx, second.id)).status).toBe("picked_up");
    });
  });

  it("refuses a task of a colleague, an open task and a number that does not exist, all alike", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUp(tx);
      const hers = await seedTask(tx, office, customerId, { assignee: jens });
      const open = await seedTask(tx, office, customerId, { status: "open", assignee: null });

      for (const number of [hers.number, open.number, 999_999_999]) {
        expect(
          await pickUpTaskInTransaction(tx, {
            actor: technician(kevin),
            number,
            version: hers.version,
          }),
        ).toEqual({ kind: "not-assigned" });
      }
      expect(await readTask(tx, hers.id)).toMatchObject({ status: "assigned", assigneeId: jens });
      expect((await readTask(tx, open.id)).status).toBe("open");
    });
  });

  it("refuses the back office, which can never pick up on behalf of a technician (V10)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { assignee: kevin });
      expect(
        await pickUpTaskInTransaction(tx, {
          actor: { id: office, role: "backoffice", isActive: true },
          number: task.number,
          version: task.version,
        }),
      ).toEqual({ kind: "not-assigned" });
      expect((await readTask(tx, task.id)).status).toBe("assigned");
    });
  });

  it("tells a technician that his task was cancelled, and a colleague nothing about it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { status: "cancelled", assignee: kevin });
      const input = { number: task.number, version: task.version };

      expect(await pickUpTaskInTransaction(tx, { actor: technician(kevin), ...input })).toEqual({
        kind: "cancelled",
      });
      expect(await pickUpTaskInTransaction(tx, { actor: technician(jens), ...input })).toEqual({
        kind: "not-assigned",
      });
      expect((await readTask(tx, task.id)).status).toBe("cancelled");
    });
  });

  it("confirms silently a task that he picked up already, even with an old version, and writes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUp(tx);
      const picked = await seedTask(tx, office, customerId, {
        status: "picked_up",
        assignee: kevin,
      });
      const before = await readTask(tx, picked.id);

      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(kevin),
          number: picked.number,
          version: "2020-01-01T00:00:00.000000Z",
        }),
      ).toEqual({ kind: "already-picked-up" });
      // Not even `updated_at` or `updated_by` moved.
      expect(await readTask(tx, picked.id)).toEqual(before);

      // A colleague learns nothing about it.
      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(jens),
          number: picked.number,
          version: picked.version,
        }),
      ).toEqual({ kind: "not-assigned" });
    });
  });

  it("refuses a task that is not Toegewezen any more: finished", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const done = await seedTask(tx, office, customerId, { status: "completed", assignee: kevin });

      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(kevin),
          number: done.number,
          version: done.version,
        }),
      ).toEqual({ kind: "changed" });
      expect((await readTask(tx, done.id)).status).toBe("completed");
    });
  });

  it("refuses a technician who was switched off", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUp(tx);
      const gone = await createProfile(tx, "Bram Weg", { isActive: false });
      const task = await seedTask(tx, office, customerId, { assignee: gone });
      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(gone), // The session said "active"; the database knows better.
          number: task.number,
          version: task.version,
        }),
      ).toEqual({ kind: "inactive" });
      expect((await readTask(tx, task.id)).status).toBe("assigned");
    });
  });

  it("refuses when the task was edited after the page was opened (the version)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUp(tx);
      const task = await seedTask(tx, office, customerId, { assignee: kevin });
      await tx
        .update(schema.tasks)
        .set({ instructions: "Andere instructies", updatedBy: office })
        .where(eq(schema.tasks.id, task.id));

      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(kevin),
          number: task.number,
          version: task.version,
        }),
      ).toEqual({ kind: "changed" });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "assigned",
        pickedUpAt: null,
        instructions: "Andere instructies",
      });
    });
  });
});

// The next tests need two connections, so their data is committed and removed afterwards.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeTestData() {
  const like = `%race%${emailSuffix}`;
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
  const task = await seedTask(db, office, customerId, { assignee: kevin });
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

/** Starts a pick-up on its own connection and reports whether it is still waiting. */
function startPickUp(kevin: string, task: { number: number; version: string }) {
  let finished = false;
  const outcome = connect()
    .transaction((tx) => pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }))
    .finally(() => (finished = true));
  return { outcome, isFinished: () => finished };
}

describe("pickUpTaskInTransaction: the office acts at the same moment", () => {
  it("a cancellation that is under way wins: the pick-up waits and is told 'cancelled'", async () => {
    const { office, kevin, task } = await setUpRace();
    try {
      const cancel = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await cancel.isReady;

      const pickUp = startPickUp(kevin, task);
      await sleep(400);
      expect(pickUp.isFinished()).toBe(false); // It waits for the lock; it does not overwrite.

      cancel.release();
      await cancel.result;
      expect(await pickUp.outcome).toEqual({ kind: "cancelled" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "cancelled", pickedUpAt: null });
    } finally {
      await removeTestData();
    }
  });

  it("a reassignment that is under way wins: 'not-assigned', the colleague keeps the task", async () => {
    const { kevin, jens, task } = await setUpRace();
    try {
      const reassign = holdOpen(async (tx) => {
        await tx.update(schema.tasks).set({ assigneeId: jens }).where(eq(schema.tasks.id, task.id));
      });
      await reassign.isReady;

      const pickUp = startPickUp(kevin, task);
      await sleep(400);
      expect(pickUp.isFinished()).toBe(false);

      reassign.release();
      await reassign.result;
      expect(await pickUp.outcome).toEqual({ kind: "not-assigned" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "assigned",
        assigneeId: jens,
        pickedUpAt: null,
      });
    } finally {
      await removeTestData();
    }
  });

  it("'Nog niet toewijzen' that is under way wins: 'not-assigned', the task stays Open", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const unassign = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "open", assigneeId: null })
          .where(eq(schema.tasks.id, task.id));
      });
      await unassign.isReady;

      const pickUp = startPickUp(kevin, task);
      await sleep(400);
      expect(pickUp.isFinished()).toBe(false);

      unassign.release();
      await unassign.result;
      expect(await pickUp.outcome).toEqual({ kind: "not-assigned" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "open", assigneeId: null });
    } finally {
      await removeTestData();
    }
  });

  it("an edit that is under way wins: the pick-up waits and is told 'changed'", async () => {
    const { office, kevin, task } = await setUpRace();
    try {
      const edit = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ instructions: "Andere klus", updatedBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await edit.isReady;

      const pickUp = startPickUp(kevin, task);
      await sleep(400);
      expect(pickUp.isFinished()).toBe(false);

      edit.release();
      await edit.result;
      expect(await pickUp.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "assigned",
        instructions: "Andere klus",
        pickedUpAt: null,
      });
    } finally {
      await removeTestData();
    }
  });

  it("a page that was opened before a pick-up and a reset gets 'changed' and the reset stays", async () => {
    const { office, kevin, task } = await setUpRace();
    try {
      // Another device picked the task up, and the office put it back (Terugzetten wipes the time).
      expect(
        await db.transaction((tx) =>
          pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
        ),
      ).toMatchObject({ kind: "picked-up" });
      await db
        .update(schema.tasks)
        .set({ status: "assigned", pickedUpAt: null, updatedBy: office })
        .where(eq(schema.tasks.id, task.id));

      // The old page still shows "Oppikken" with the old version.
      const stale = await db.transaction((tx) =>
        pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
      );
      expect(stale).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "assigned", pickedUpAt: null });

      // After looking at the task again (a fresh version) the pick-up works.
      const fresh = (await queryTaskDetail(db, task.number))!.version;
      expect(
        await db.transaction((tx) =>
          pickUpTaskInTransaction(tx, {
            actor: technician(kevin),
            number: task.number,
            version: fresh,
          }),
        ),
      ).toMatchObject({ kind: "picked-up" });
    } finally {
      await removeTestData();
    }
  });

  it("two pick-ups of the same task (two devices): one wins, the other is silently confirmed", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const first = holdOpen((tx) =>
        pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
      );
      await first.isReady;

      const second = startPickUp(kevin, task);
      await sleep(400);
      expect(second.isFinished()).toBe(false);

      first.release();
      expect(await first.result).toMatchObject({ kind: "picked-up" });
      expect(await second.outcome).toEqual({ kind: "already-picked-up" });
      expect((await readTask(db, task.id)).status).toBe("picked_up");
    } finally {
      await removeTestData();
    }
  });

  it("a switch-off that is under way: the pick-up waits, and (open tasks) the switch-off is refused", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const switchOff = holdOpen((tx) => deactivateTechnicianProfile(tx, kevin));
      await switchOff.isReady;

      const pickUp = startPickUp(kevin, task);
      await sleep(400);
      expect(pickUp.isFinished()).toBe(false); // Waits for the lock on his profile.

      switchOff.release();
      // He has an open task, so the switch-off refuses and he stays active.
      expect(await switchOff.result).toMatchObject({ kind: "open-tasks", openTasks: 1 });
      expect(await pickUp.outcome).toMatchObject({ kind: "picked-up" });
      expect(await readProfileActive(kevin)).toBe(true);
    } finally {
      await removeTestData();
    }
  });

  it("a pick-up that is under way: the switch-off waits, counts the picked up task and is refused", async () => {
    const { kevin, task } = await setUpRace();
    try {
      const pickUp = holdOpen((tx) =>
        pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
      );
      await pickUp.isReady;

      let finished = false;
      const switchOff = connect()
        .transaction((tx) => deactivateTechnicianProfile(tx, kevin))
        .finally(() => (finished = true));
      await sleep(400);
      expect(finished).toBe(false); // Waits for the share lock of the pick-up.

      pickUp.release();
      expect(await pickUp.result).toMatchObject({ kind: "picked-up" });
      expect(await switchOff).toMatchObject({ kind: "open-tasks", openTasks: 1 });
      expect(await readProfileActive(kevin)).toBe(true);
    } finally {
      await removeTestData();
    }
  });

  it("a technician who is switched off by other means while he picks up: the pick-up waits and is refused", async () => {
    const { kevin, task } = await setUpRace();
    try {
      // The switch-off rule for open tasks is bypassed on purpose (for example repaired by hand):
      // the pick-up must still not go through.
      const switchOff = holdOpen(async (tx) => {
        await tx
          .update(schema.profiles)
          .set({ isActive: false, deactivatedAt: new Date() })
          .where(eq(schema.profiles.id, kevin));
      });
      await switchOff.isReady;

      const pickUp = startPickUp(kevin, task);
      await sleep(400);
      expect(pickUp.isFinished()).toBe(false);

      switchOff.release();
      await switchOff.result;
      expect(await pickUp.outcome).toEqual({ kind: "inactive" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "assigned", pickedUpAt: null });
    } finally {
      await removeTestData();
    }
  });
});

async function readProfileActive(id: string): Promise<boolean> {
  const [row] = await db
    .select({ isActive: schema.profiles.isActive })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, id));
  return row.isActive;
}
