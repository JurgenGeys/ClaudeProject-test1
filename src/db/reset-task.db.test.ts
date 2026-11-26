import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { completeTaskInTransaction } from "@/lib/tasks/complete";
import { pickUpTaskInTransaction } from "@/lib/tasks/pick-up";
import { resetTaskInTransaction } from "@/lib/tasks/reset";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";

// "Taak terugzetten" (BT-14) against the real database (local Supabase in CI): what is saved,
// every refusal, and what happens when the technician finishes or picks up, or a colleague edits
// or switches the technician off, at the same moment. The first group runs in a transaction that
// is always rolled back. The races need two connections that see each other's locks, so their
// data is committed and removed again afterwards.
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

const emailSuffix = "@reset-test.example";

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
    insert into public.customers (name, created_by) values ('Terugzet-testklant', ${createdBy})
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

const NEW_PLAN = { scheduledDate: "2030-04-02", startTime: "08:00" };

/** What the dialog sends, for a task in the state of the page that was opened. */
const reset = (
  task: { number: number; version: string },
  assigneeId: string,
  plan: { scheduledDate: string; startTime: string } = NEW_PLAN,
) => ({ number: task.number, version: task.version, assigneeId, ...plan });

/** An Opgepikt task of Kevin, the state in which B3 offers Terugzetten. */
function seedPickedUp(tx: Tx | Db, officeId: string, customerId: string, kevin: string) {
  return seedTask(tx, officeId, customerId, { status: "picked_up", assignee: kevin });
}

describe("resetTaskInTransaction", () => {
  it("makes the task Toegewezen to the same technician, clears the pick-up time and sets the planning", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);

      const outcome = await resetTaskInTransaction(tx, {
        actor: office(sofie),
        data: reset(task, kevin),
      });

      expect(outcome).toEqual({
        kind: "reset",
        id: task.id,
        number: task.number,
        assigneeName: "Kevin Wouters",
        scheduledDate: "2030-04-02",
        startTime: "08:00:00",
      });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "assigned",
        assigneeId: kevin,
        pickedUpAt: null,
        scheduledDate: "2030-04-02",
        startTime: "08:00:00",
        updatedBy: sofie,
        // Nothing else of the task changes.
        instructions: "Onderhoud",
        locationCity: "Turnhout",
        createdBy: sofie,
      });
      expect(await completionsOf(tx, task.id)).toHaveLength(0);
    });
  });

  it("gives the task to another technician, who then has it, and Kevin no longer", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, jens, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);

      expect(
        await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, jens) }),
      ).toMatchObject({ kind: "reset", assigneeName: "Jens Maes" });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "assigned",
        assigneeId: jens,
        pickedUpAt: null,
      });
      expect(await queryTaskDetail(tx, task.number, { assigneeId: kevin })).toBeNull();
      expect(await queryTaskDetail(tx, task.number, { assigneeId: jens })).not.toBeNull();
    });
  });

  it("moves the version (updated_at) with the database trigger, so an old page is recognised", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);
      await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) });
      expect((await queryTaskDetail(tx, task.number))!.version).not.toBe(task.version);
    });
  });

  it("lets the technician pick the task up again afterwards (fresh version)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);
      await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) });
      const fresh = (await queryTaskDetail(tx, task.number))!.version;
      expect(
        await pickUpTaskInTransaction(tx, {
          actor: technician(kevin),
          number: task.number,
          version: fresh,
        }),
      ).toMatchObject({ kind: "picked-up" });
    });
  });

  it("refuses a number that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin } = await setUp(tx);
      expect(
        await resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: reset({ number: 2147483000, version: "2026-11-25T18:44:00.123456Z" }, kevin),
        }),
      ).toEqual({ kind: "not-found" });
    });
  });

  it.each(["open", "assigned", "completed", "invoiced", "cancelled"] as const)(
    "refuses a %s task as 'changed' and writes nothing",
    async (status) => {
      await inRolledBackTransaction(async (tx) => {
        const { office: sofie, kevin, jens, customerId } = await setUp(tx);
        const task = await seedTask(tx, sofie, customerId, {
          status,
          assignee: status === "open" ? null : kevin,
        });
        const before = await readTask(tx, task.id);

        expect(
          await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, jens) }),
        ).toEqual({ kind: "changed" });
        expect(await readTask(tx, task.id)).toEqual(before);
      });
    },
  );

  it("leaves the hours report of a finished task alone", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);
      await completeTaskInTransaction(tx, {
        actor: technician(kevin),
        number: task.number,
        version: task.version,
        workedMinutes: 90,
        notes: null,
      });
      const fresh = (await queryTaskDetail(tx, task.number))!.version;

      expect(
        await resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: reset({ number: task.number, version: fresh }, kevin),
        }),
      ).toEqual({ kind: "changed" });
      expect(await completionsOf(tx, task.id)).toHaveLength(1);
      expect((await readTask(tx, task.id)).status).toBe("completed");
    });
  });

  it("refuses when the task was edited after the page was opened (the version)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);
      await tx
        .update(schema.tasks)
        .set({ instructions: "Andere instructies", updatedBy: sofie })
        .where(eq(schema.tasks.id, task.id));

      expect(
        await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) }),
      ).toEqual({ kind: "changed" });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "picked_up",
        instructions: "Andere instructies",
      });
    });
  });

  it("refuses a technician who is switched off, and one who was invited and has no password yet", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const gone = await createProfile(tx, "Gone Technician", { isActive: false });
      const invited = await createProfile(tx, "Invited Technician");
      await tx
        .update(schema.profiles)
        .set({ invitePending: true })
        .where(eq(schema.profiles.id, invited));
      const task = await seedPickedUp(tx, sofie, customerId, kevin);

      expect(
        await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, gone) }),
      ).toEqual({ kind: "assignee-inactive", fullName: "Gone Technician" });
      expect(
        await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, invited) }),
      ).toEqual({ kind: "assignee-invited", fullName: "Invited Technician" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "picked_up", assigneeId: kevin });
    });
  });

  it("refuses an id that is no technician (the office, or nobody)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);

      expect(
        await resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, sofie) }),
      ).toEqual({ kind: "assignee-not-found" });
      expect(
        await resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: reset(task, "99999999-9999-4999-8999-999999999999"),
        }),
      ).toEqual({ kind: "assignee-not-found" });
    });
  });

  it("refuses a technician as the actor (only the back office resets)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office: sofie, kevin, customerId } = await setUp(tx);
      const task = await seedPickedUp(tx, sofie, customerId, kevin);
      expect(
        await resetTaskInTransaction(tx, { actor: technician(kevin), data: reset(task, kevin) }),
      ).toEqual({ kind: "refused", reason: "wrong_role" });
      expect((await readTask(tx, task.id)).status).toBe("picked_up");
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

async function setUpRace() {
  await removeTestData();
  const sofie = await createProfile(db, "Race Office", { role: "backoffice" });
  const kevin = await createProfile(db, "Race Kevin");
  const jens = await createProfile(db, "Race Jens");
  const customerId = await createCustomer(db, sofie);
  const task = await seedPickedUp(db, sofie, customerId, kevin);
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

const completeAs = (kevin: string, task: { number: number; version: string }) => ({
  actor: technician(kevin),
  number: task.number,
  version: task.version,
  workedMinutes: 90,
  notes: "Filter vervangen" as string | null,
});

describe("resetTaskInTransaction: the technician acts at the same moment", () => {
  it("a completion that is under way wins: the reset waits and is told 'changed', the hours stay", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const completing = holdOpen((tx) => completeTaskInTransaction(tx, completeAs(kevin, task)));
      await completing.isReady;

      const resetting = start((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) }),
      );
      await sleep(400);
      expect(resetting.isFinished()).toBe(false); // Waits for the lock on the task.

      completing.release();
      expect(await completing.result).toMatchObject({ kind: "completed" });
      expect(await resetting.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "completed" });
      expect(await completionsOf(db, task.id)).toHaveLength(1);
    } finally {
      await removeTestData();
    }
  });

  it("a reset that is under way wins: the completion waits and is told 'changed', no hours are saved", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const resetting = holdOpen((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) }),
      );
      await resetting.isReady;

      const completing = start((tx) => completeTaskInTransaction(tx, completeAs(kevin, task)));
      await sleep(400);
      expect(completing.isFinished()).toBe(false);

      resetting.release();
      expect(await resetting.result).toMatchObject({ kind: "reset" });
      expect(await completing.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "assigned",
        pickedUpAt: null,
        assigneeId: kevin,
      });
      expect(await completionsOf(db, task.id)).toHaveLength(0);
    } finally {
      await removeTestData();
    }
  });

  it("a reset to another technician that is under way: the completion is told the task is not his any more", async () => {
    const { sofie, kevin, jens, task } = await setUpRace();
    try {
      const resetting = holdOpen((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, jens) }),
      );
      await resetting.isReady;

      const completing = start((tx) => completeTaskInTransaction(tx, completeAs(kevin, task)));
      await sleep(400);
      expect(completing.isFinished()).toBe(false);

      resetting.release();
      await resetting.result;
      expect(await completing.outcome).toEqual({ kind: "not-assigned" });
      expect(await completionsOf(db, task.id)).toHaveLength(0);
    } finally {
      await removeTestData();
    }
  });

  it("a pick-up on a page from before the reset is told 'changed' and the reset stays", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const resetting = holdOpen((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) }),
      );
      await resetting.isReady;

      const pickingUp = start((tx) =>
        pickUpTaskInTransaction(tx, { actor: technician(kevin), ...task }),
      );
      await sleep(400);
      expect(pickingUp.isFinished()).toBe(false);

      resetting.release();
      await resetting.result;
      expect(await pickingUp.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "assigned", pickedUpAt: null });
    } finally {
      await removeTestData();
    }
  });
});

describe("resetTaskInTransaction: other changes at the same moment", () => {
  it("an edit by a colleague that is under way wins: the reset waits and is told 'changed', the edit stays", async () => {
    const { sofie, kevin, task } = await setUpRace();
    try {
      const edit = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ instructions: "Andere klus", updatedBy: sofie })
          .where(eq(schema.tasks.id, task.id));
      });
      await edit.isReady;

      const resetting = start((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) }),
      );
      await sleep(400);
      expect(resetting.isFinished()).toBe(false);

      edit.release();
      await edit.result;
      expect(await resetting.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        status: "picked_up",
        instructions: "Andere klus",
      });
    } finally {
      await removeTestData();
    }
  });

  it("two resets of the same task: one wins, the other is told 'changed' and the first planning stays", async () => {
    const { sofie, kevin, jens, task } = await setUpRace();
    try {
      const first = holdOpen((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, kevin) }),
      );
      await first.isReady;

      const second = start((tx) =>
        resetTaskInTransaction(tx, {
          actor: office(sofie),
          data: reset(task, jens, { scheduledDate: "2030-05-05", startTime: "10:00" }),
        }),
      );
      await sleep(400);
      expect(second.isFinished()).toBe(false);

      first.release();
      expect(await first.result).toMatchObject({ kind: "reset" });
      expect(await second.outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        assigneeId: kevin,
        scheduledDate: "2030-04-02",
      });
    } finally {
      await removeTestData();
    }
  });

  it("a switch-off of the chosen technician that is under way: the reset waits and is refused", async () => {
    const { sofie, kevin, jens, task } = await setUpRace();
    try {
      const switchOff = holdOpen((tx) => deactivateTechnicianProfile(tx, jens));
      await switchOff.isReady;

      const resetting = start((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, jens) }),
      );
      await sleep(400);
      expect(resetting.isFinished()).toBe(false); // Waits for the lock on his profile.

      switchOff.release();
      expect(await switchOff.result).toMatchObject({ kind: "deactivated" });
      expect(await resetting.outcome).toEqual({ kind: "assignee-inactive", fullName: "Race Jens" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "picked_up", assigneeId: kevin });
    } finally {
      await removeTestData();
    }
  });

  it("a reset to a technician that is under way: his switch-off waits, counts the task and is refused", async () => {
    const { sofie, jens, task } = await setUpRace();
    try {
      const resetting = holdOpen((tx) =>
        resetTaskInTransaction(tx, { actor: office(sofie), data: reset(task, jens) }),
      );
      await resetting.isReady;

      const switchOff = start((tx) => deactivateTechnicianProfile(tx, jens));
      await sleep(400);
      expect(switchOff.isFinished()).toBe(false);

      resetting.release();
      expect(await resetting.result).toMatchObject({ kind: "reset" });
      expect(await switchOff.outcome).toMatchObject({ kind: "open-tasks", openTasks: 1 });
    } finally {
      await removeTestData();
    }
  });
});
