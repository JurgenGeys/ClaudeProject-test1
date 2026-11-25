import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { findCustomers } from "@/lib/customers/search";
import { createTaskInTransaction } from "@/lib/tasks/create";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";
import { queryAssignableTechnicians } from "@/lib/technicians/queries";
import type { CreateTaskData } from "@/lib/validation/create-task";

// "Taak aanmaken" (BT-08) against the real database (local Supabase in CI): the task and the
// new customer that are saved together, the rules that refuse a technician, and the lock
// (`FOR SHARE`) that keeps "is the technician still active?" true at the moment of saving.
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

const emailSuffix = "@create-task-test.example";

async function createProfile(
  tx: Pick<Db, "execute">,
  name: string,
  fields: { role?: string; isActive?: boolean; invitePending?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}${emailSuffix}`;
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
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, street, postal_code, city, created_by)
    values ('Klant', 'Klantstraat 1', '2000', 'Antwerpen', ${createdBy}) returning id
  `);
  return customer.id;
}

function taskData(overrides: Partial<CreateTaskData>): CreateTaskData {
  return {
    customer: { kind: "existing", id: "00000000-0000-4000-8000-000000000000" },
    location: {
      locationStreet: "Kerkstraat 12",
      locationPostalCode: "2310",
      locationCity: "Rijkevorsel",
    },
    workType: "maintenance",
    instructions: "Jaarlijks onderhoud\nFilter vervangen",
    scheduledDate: "2030-03-15",
    startTime: "14:15",
    estimatedMinutes: null,
    assigneeId: null,
    ...overrides,
  };
}

const sofie = (id: string) => ({ id, role: "backoffice" as const, isActive: true });

async function readTask(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return row;
}

async function count(tx: Pick<Db, "execute">, table: "tasks" | "customers", by: string) {
  const [row] = await tx.execute<{ total: number }>(
    sql`select count(*)::int as total from ${sql.raw(`public.${table}`)} where created_by = ${by}`,
  );
  return row.total;
}

describe("createTaskInTransaction: saving", () => {
  it("saves an Open task without a technician, with everything of the form, and the number from the database", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const customerId = await createCustomer(tx, office);

      const outcome = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({ customer: { kind: "existing", id: customerId }, estimatedMinutes: 90 }),
      });
      expect(outcome).toMatchObject({ kind: "created", status: "open" });
      if (outcome.kind !== "created") return;

      expect(outcome.number).toBeGreaterThanOrEqual(1001);
      const task = await readTask(tx, outcome.id);
      expect(task).toMatchObject({
        number: outcome.number,
        customerId,
        // The location is the one of the form, not the address of the customer.
        locationStreet: "Kerkstraat 12",
        locationPostalCode: "2310",
        locationCity: "Rijkevorsel",
        workType: "maintenance",
        instructions: "Jaarlijks onderhoud\nFilter vervangen",
        scheduledDate: "2030-03-15",
        estimatedMinutes: 90,
        assigneeId: null,
        status: "open",
        pickedUpAt: null,
        createdBy: office,
        updatedBy: office,
      });
      expect(task.startTime).toBe("14:15:00");
    });
  });

  it("saves a Toegewezen task with an active technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      const customerId = await createCustomer(tx, office);

      const outcome = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({ customer: { kind: "existing", id: customerId }, assigneeId: kevin }),
      });
      expect(outcome).toMatchObject({ kind: "created", status: "assigned" });
      if (outcome.kind !== "created") return;
      expect(await readTask(tx, outcome.id)).toMatchObject({
        status: "assigned",
        assigneeId: kevin,
        createdBy: office,
        updatedBy: office,
      });
    });
  });

  it("hands out increasing numbers", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const customer = { kind: "existing" as const, id: await createCustomer(tx, office) };
      const first = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({ customer }),
      });
      const second = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({ customer }),
      });
      expect(first.kind === "created" && second.kind === "created").toBe(true);
      if (first.kind === "created" && second.kind === "created") {
        expect(second.number).toBeGreaterThan(first.number);
      }
    });
  });

  it("saves a new customer with the task: the address is the location, the creator is the actor", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const outcome = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({
          customer: {
            kind: "new",
            data: {
              name: "Bakkerij De Gouden Korst",
              phone: "014 41 22 87",
              email: null,
              notes: "Sleutel bij de buren",
              street: "Kerkstraat 12",
              postalCode: "2310",
              city: "Rijkevorsel",
            },
          },
        }),
      });
      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") return;

      const task = await readTask(tx, outcome.id);
      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, task.customerId));
      expect(customer).toMatchObject({
        name: "Bakkerij De Gouden Korst",
        street: "Kerkstraat 12",
        postalCode: "2310",
        city: "Rijkevorsel",
        phone: "014 41 22 87",
        email: null,
        notes: "Sleutel bij de buren",
        createdBy: office,
      });
    });
  });
});

describe("createTaskInTransaction: refusing", () => {
  it("refuses a customer that does not exist, and saves nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const outcome = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({}),
      });
      expect(outcome).toEqual({ kind: "customer-not-found" });
      expect(await count(tx, "tasks", office)).toBe(0);
    });
  });

  it("refuses a technician who is switched off, and does not save the new customer either", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const bram = await createProfile(tx, "Bram Claes", { isActive: false });
      const outcome = await createTaskInTransaction(tx, {
        actor: sofie(office),
        data: taskData({
          assigneeId: bram,
          customer: {
            kind: "new",
            data: {
              name: "Nieuwe klant",
              phone: null,
              email: null,
              notes: null,
              street: "Kerkstraat 12",
              postalCode: "2310",
              city: "Rijkevorsel",
            },
          },
        }),
      });
      expect(outcome).toEqual({ kind: "assignee-inactive", fullName: "Bram Claes" });
      expect(await count(tx, "tasks", office)).toBe(0);
      expect(await count(tx, "customers", office)).toBe(0);
    });
  });

  it("refuses an invited technician who did not choose a password yet", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const yana = await createProfile(tx, "Yana Willems", { invitePending: true });
      const customer = { kind: "existing" as const, id: await createCustomer(tx, office) };
      expect(
        await createTaskInTransaction(tx, {
          actor: sofie(office),
          data: taskData({ customer, assigneeId: yana }),
        }),
      ).toEqual({ kind: "assignee-invited", fullName: "Yana Willems" });
      expect(await count(tx, "tasks", office)).toBe(0);
    });
  });

  it("refuses an unknown id and a user who is no technician, with the same outcome", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const colleague = await createProfile(tx, "Els Janssens", { role: "backoffice" });
      const customer = { kind: "existing" as const, id: await createCustomer(tx, office) };
      for (const assigneeId of ["00000000-0000-4000-8000-000000000000", colleague, office]) {
        expect(
          await createTaskInTransaction(tx, {
            actor: sofie(office),
            data: taskData({ customer, assigneeId }),
          }),
        ).toEqual({ kind: "assignee-not-found" });
      }
      expect(await count(tx, "tasks", office)).toBe(0);
    });
  });

  it("refuses an actor who is not backoffice, through the transition rules", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      const customer = { kind: "existing" as const, id: await createCustomer(tx, office) };
      expect(
        await createTaskInTransaction(tx, {
          actor: { id: kevin, role: "technician", isActive: true },
          data: taskData({ customer }),
        }),
      ).toEqual({ kind: "refused", reason: "wrong_role" });
      expect(await count(tx, "tasks", kevin)).toBe(0);
    });
  });

  it("rolls back the customer when the task cannot be saved (a committed transaction)", async () => {
    const name = `Rollback klant ${Date.now()}`;
    const office = await createProfile(db, "Sofie Rollback", { role: "backoffice" });
    try {
      // 20 minutes is no quarter: the check constraint of the task refuses it, after the
      // customer was inserted.
      await expect(
        db.transaction((tx) =>
          createTaskInTransaction(tx, {
            actor: sofie(office),
            data: taskData({
              estimatedMinutes: 20,
              customer: {
                kind: "new",
                data: {
                  name,
                  phone: null,
                  email: null,
                  notes: null,
                  street: "Kerkstraat 12",
                  postalCode: "2310",
                  city: "Rijkevorsel",
                },
              },
            }),
          }),
        ),
      ).rejects.toThrow();
      expect(await count(db, "customers", office)).toBe(0);
      expect(await count(db, "tasks", office)).toBe(0);
    } finally {
      await removeTestData("%rollback%");
    }
  });
});

describe("queryAssignableTechnicians", () => {
  it("lists active technicians with a password, by name, and leaves out the rest", async () => {
    await inRolledBackTransaction(async (tx) => {
      const kevin = await createProfile(tx, "Kevin Wouters");
      const jens = await createProfile(tx, "Jens Maes");
      const bram = await createProfile(tx, "Bram Claes", { isActive: false });
      const yana = await createProfile(tx, "Yana Willems", { invitePending: true });
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });

      const all = await queryAssignableTechnicians(tx);
      const ours = all.filter((technician) =>
        [kevin, jens, bram, yana, office].includes(technician.id),
      );
      expect(ours).toEqual([
        { id: jens, fullName: "Jens Maes" },
        { id: kevin, fullName: "Kevin Wouters" },
      ]);
    });
  });
});

describe("findCustomers", () => {
  async function seed(tx: Tx) {
    const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
    const add = (name: string, phone: string | null, city: string | null) =>
      tx.insert(schema.customers).values({ name, phone, city, createdBy: office });
    await add("Zqxbakkerij Van Loon", "014 65 10 32", "Weelde");
    await add("Zqxbakkerij De Gouden Korst", "014 41 22 87", "Turnhout");
    await add("Zqxslager Peeters", "03 123 45 67", "Turnhout");
    await add("Zqx 100% Koud", null, null);
    await add("Zqx 100x Koud", null, null);
  }

  it("finds by a part of the name, the phone number or the city, in any case, sorted by name", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const names = async (text: string) => (await findCustomers(tx, text)).map((c) => c.name);
      expect(await names("ZQXBAK")).toEqual([
        "Zqxbakkerij De Gouden Korst",
        "Zqxbakkerij Van Loon",
      ]);
      expect(await names("014 41")).toEqual(["Zqxbakkerij De Gouden Korst"]);
      expect(await names("turnh")).toEqual(["Zqxbakkerij De Gouden Korst", "Zqxslager Peeters"]);
    });
  });

  it("takes % and _ literally", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      expect((await findCustomers(tx, "zqx 100%")).map((c) => c.name)).toEqual(["Zqx 100% Koud"]);
      expect(await findCustomers(tx, "%%")).toEqual([]);
      expect(await findCustomers(tx, "zqx 100_")).toEqual([]);
    });
  });

  it("returns the fields the picker needs, at most 8 customers, and nothing for a short text", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      for (let index = 1; index <= 10; index++) {
        await tx.insert(schema.customers).values({
          name: `Zqy klant ${String(index).padStart(2, "0")}`,
          street: "Straat 1",
          postalCode: "2000",
          city: "Antwerpen",
          createdBy: office,
        });
      }
      const found = await findCustomers(tx, "zqy klant");
      expect(found).toHaveLength(8);
      expect(found[0]).toEqual({
        id: expect.any(String),
        name: "Zqy klant 01",
        street: "Straat 1",
        postalCode: "2000",
        city: "Antwerpen",
        phone: null,
      });
      expect(found.at(-1)?.name).toBe("Zqy klant 08");
      expect(await findCustomers(tx, "z")).toEqual([]);
      expect(await findCustomers(tx, "  ")).toEqual([]);
    });
  });
});

// The next tests need two connections that see each other's locks, so their data is committed
// and removed again afterwards.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeTestData(pattern = "%race%") {
  const like = pattern + emailSuffix;
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

describe("createTaskInTransaction: a technician switched off at the same moment", () => {
  async function setUp() {
    await removeTestData();
    const office = await createProfile(db, "Race Office", { role: "backoffice" });
    const kevin = await createProfile(db, "Race Kevin");
    const customerId = await createCustomer(db, office);
    return { office, kevin, customerId };
  }

  it("waits for a switch-off that is under way, and then sees the technician as switched off", async () => {
    const { office, kevin, customerId } = await setUp();
    try {
      const switcher = connect();
      let releaseSwitchOff!: () => void;
      const switchOffMayCommit = new Promise<void>((resolve) => (releaseSwitchOff = resolve));
      let switchedOff!: () => void;
      const done = new Promise<void>((resolve) => (switchedOff = resolve));

      const switchOff = switcher.transaction(async (tx) => {
        const outcome = await deactivateTechnicianProfile(tx, kevin);
        switchedOff();
        await switchOffMayCommit;
        return outcome;
      });
      await done;

      let finished = false;
      const creating = db
        .transaction((tx) =>
          createTaskInTransaction(tx, {
            actor: sofie(office),
            data: taskData({ customer: { kind: "existing", id: customerId }, assigneeId: kevin }),
          }),
        )
        .finally(() => (finished = true));
      await sleep(400);
      // The save waits for the switch-off instead of reading the old state.
      expect(finished).toBe(false);

      releaseSwitchOff();
      expect(await switchOff).toMatchObject({ kind: "deactivated" });
      expect(await creating).toEqual({ kind: "assignee-inactive", fullName: "Race Kevin" });
      expect(await count(db, "tasks", office)).toBe(0);
    } finally {
      await removeTestData();
    }
  });

  it("makes a switch-off wait for a task that is being saved, and then counts that task", async () => {
    const { office, kevin, customerId } = await setUp();
    try {
      const creator = connect();
      let releaseCreation!: () => void;
      const creationMayCommit = new Promise<void>((resolve) => (releaseCreation = resolve));
      let created!: () => void;
      const done = new Promise<void>((resolve) => (created = resolve));

      const creating = creator.transaction(async (tx) => {
        const outcome = await createTaskInTransaction(tx, {
          actor: sofie(office),
          data: taskData({ customer: { kind: "existing", id: customerId }, assigneeId: kevin }),
        });
        created();
        await creationMayCommit;
        return outcome;
      });
      await done;

      let finished = false;
      const switchOff = db
        .transaction((tx) => deactivateTechnicianProfile(tx, kevin))
        .finally(() => (finished = true));
      await sleep(400);
      expect(finished).toBe(false);

      releaseCreation();
      expect(await creating).toMatchObject({ kind: "created", status: "assigned" });
      expect(await switchOff).toEqual({
        kind: "open-tasks",
        fullName: "Race Kevin",
        openTasks: 1,
      });
      const [profile] = await db
        .select({ isActive: schema.profiles.isActive })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, kevin));
      expect(profile.isActive).toBe(true);
    } finally {
      await removeTestData();
    }
  });

  it("lets two tasks for the same technician be saved at the same time (the lock is shared)", async () => {
    const { office, kevin, customerId } = await setUp();
    try {
      const first = connect();
      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
      let firstSaved!: () => void;
      const done = new Promise<void>((resolve) => (firstSaved = resolve));
      const data = taskData({ customer: { kind: "existing", id: customerId }, assigneeId: kevin });

      const firstTask = first.transaction(async (tx) => {
        const outcome = await createTaskInTransaction(tx, { actor: sofie(office), data });
        firstSaved();
        await firstMayCommit;
        return outcome;
      });
      await done;

      // The first transaction is still open; the second one is not held up by it.
      const second = await db.transaction((tx) =>
        createTaskInTransaction(tx, { actor: sofie(office), data }),
      );
      expect(second).toMatchObject({ kind: "created" });
      releaseFirst();
      expect(await firstTask).toMatchObject({ kind: "created" });
      expect(await count(db, "tasks", office)).toBe(2);
    } finally {
      await removeTestData();
    }
  });
});
