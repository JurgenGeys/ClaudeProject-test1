import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { createTaskInTransaction } from "@/lib/tasks/create";
import { updateTaskInTransaction } from "@/lib/tasks/update";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";
import type { CreateTaskData } from "@/lib/validation/create-task";
import type { UpdateTaskData } from "@/lib/validation/update-task";

// "Taak bewerken" (BT-10) against the real database (local Supabase in CI): what is saved, the
// rules that refuse an edit, the version that stops a lost update, and the locks that keep the
// status and the technician right when two people act at the same moment.
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

const emailSuffix = "@update-task-test.example";

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

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string, name = "Klant") {
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, street, postal_code, city, created_by)
    values (${name}, 'Klantstraat 1', '2000', 'Antwerpen', ${createdBy}) returning id
  `);
  return customer.id;
}

const sofie = (id: string) => ({ id, role: "backoffice" as const, isActive: true });

function createData(customerId: string, assigneeId: string | null): CreateTaskData {
  return {
    customer: { kind: "existing", id: customerId },
    location: {
      locationStreet: "Kerkstraat 12",
      locationPostalCode: "2310",
      locationCity: "Rijkevorsel",
    },
    workType: "maintenance",
    instructions: "Jaarlijks onderhoud",
    scheduledDate: "2030-03-15",
    startTime: "14:15",
    estimatedMinutes: null,
    assigneeId,
  };
}

/** A saved task, and the version a form would have been opened with. */
async function seedTask(
  tx: Tx | Db,
  office: string,
  customerId: string,
  assigneeId: string | null,
) {
  const created = await createTaskInTransaction(tx, {
    actor: sofie(office),
    data: createData(customerId, assigneeId),
  });
  if (created.kind !== "created") {
    throw new Error(`seedTask: ${created.kind}`);
  }
  const detail = await queryTaskDetail(tx, created.number);
  return { number: created.number, id: created.id, version: detail!.version };
}

function edited(
  base: { number: number; version: string },
  overrides: Partial<UpdateTaskData> & { customerId: string },
): UpdateTaskData {
  const { customerId, ...rest } = overrides;
  return {
    ...createData(customerId, null),
    instructions: "Aangepast\nTweede regel",
    scheduledDate: "2030-04-01",
    startTime: "09:30",
    estimatedMinutes: 90,
    workType: "repair",
    location: {
      locationStreet: "Nieuwstraat 5",
      locationPostalCode: "9000",
      locationCity: "Gent",
    },
    ...base,
    ...rest,
  };
}

async function readTask(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return row;
}

async function setUpBasic(tx: Tx) {
  const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
  const other = await createProfile(tx, "Els Janssens", { role: "backoffice" });
  const kevin = await createProfile(tx, "Kevin Wouters");
  const jens = await createProfile(tx, "Jens Maes");
  const customerId = await createCustomer(tx, office);
  return { office, other, kevin, jens, customerId };
}

describe("updateTaskInTransaction: saving", () => {
  it("saves everything of the form, keeps number, creator and creation time, and sets the editor and the clock", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, other, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const before = await readTask(tx, task.id);

      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(other),
        data: edited(task, { customerId, assigneeId: kevin }),
      });
      expect(outcome).toEqual({
        kind: "updated",
        id: task.id,
        number: task.number,
        status: "assigned",
      });

      const after = await readTask(tx, task.id);
      expect(after).toMatchObject({
        number: task.number,
        status: "assigned",
        assigneeId: kevin,
        workType: "repair",
        instructions: "Aangepast\nTweede regel",
        scheduledDate: "2030-04-01",
        startTime: "09:30:00",
        estimatedMinutes: 90,
        locationStreet: "Nieuwstraat 5",
        locationPostalCode: "9000",
        locationCity: "Gent",
        createdBy: office,
        updatedBy: other,
        pickedUpAt: null,
      });
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    });
  });

  it("gives the task a new version, so the old form cannot be saved again", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      expect(task.version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

      const first = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: kevin }),
      });
      expect(first.kind).toBe("updated");
      const newVersion = (await queryTaskDetail(tx, task.number))!.version;
      expect(newVersion).not.toBe(task.version);

      // The same form again (old version): refused. The new version works.
      const again = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: kevin }),
      });
      expect(again).toEqual({ kind: "changed" });
      const third = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(
          { number: task.number, version: newVersion },
          { customerId, assigneeId: kevin },
        ),
      });
      expect(third.kind).toBe("updated");
    });
  });

  it("reads the version the same under another TimeZone and DateStyle of the session, and it still matches", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      await tx.execute(sql`set local timezone = 'Asia/Tokyo'`);
      await tx.execute(sql`set local datestyle = 'German, DMY'`);
      expect((await queryTaskDetail(tx, task.number))!.version).toBe(task.version);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: null }),
      });
      expect(outcome.kind).toBe("updated");
    });
  });

  it("keeps an Open task Open without a technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: null }),
      });
      expect(outcome).toMatchObject({ kind: "updated", status: "open" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "open", assigneeId: null });
    });
  });

  it("gives a Toegewezen task to another technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: jens }),
      });
      expect(outcome).toMatchObject({ kind: "updated", status: "assigned" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "assigned", assigneeId: jens });
    });
  });

  it("keeps the same technician when only the date changes", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: kevin, scheduledDate: "2031-01-02" }),
      });
      expect(outcome).toMatchObject({ kind: "updated", status: "assigned" });
      expect(await readTask(tx, task.id)).toMatchObject({
        assigneeId: kevin,
        scheduledDate: "2031-01-02",
      });
    });
  });

  it("sets a Toegewezen task back to Open with 'Nog niet toewijzen' (P2), and the technician no longer has it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: null }),
      });
      expect(outcome).toMatchObject({ kind: "updated", status: "open" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "open", assigneeId: null });
    });
  });

  it("assigns an Open task: it becomes Toegewezen", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: kevin }),
      });
      expect(outcome).toMatchObject({ kind: "updated", status: "assigned" });
    });
  });

  it("saves a new customer with the edit, and points the task at him", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, other, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(other),
        data: edited(task, {
          customerId,
          customer: {
            kind: "new",
            data: {
              name: "Nieuwe klant",
              phone: "014 00 00 00",
              email: null,
              notes: null,
              street: "Nieuwstraat 5",
              postalCode: "9000",
              city: "Gent",
            },
          },
        }),
      });
      expect(outcome.kind).toBe("updated");
      const detail = await queryTaskDetail(tx, task.number);
      expect(detail!.customer).toMatchObject({ name: "Nieuwe klant", city: "Gent" });
      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, detail!.customer.id));
      expect(customer.createdBy).toBe(other);
    });
  });

  it("points the task at another existing customer, and leaves the old customer alone", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const second = await createCustomer(tx, office, "Tweede klant");
      const task = await seedTask(tx, office, customerId, null);
      await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId: second }),
      });
      expect((await queryTaskDetail(tx, task.number))!.customer.name).toBe("Tweede klant");
      const [old] = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId));
      expect(old.name).toBe("Klant");
    });
  });
});

describe("updateTaskInTransaction: a picked up task", () => {
  async function pickedUpTask(tx: Tx) {
    const ids = await setUpBasic(tx);
    const task = await seedTask(tx, ids.office, ids.customerId, ids.kevin);
    const pickedUpAt = new Date("2030-03-15T13:00:00Z");
    await tx
      .update(schema.tasks)
      .set({ status: "picked_up", pickedUpAt })
      .where(eq(schema.tasks.id, task.id));
    const version = (await queryTaskDetail(tx, task.number))!.version;
    return { ...ids, task: { ...task, version }, pickedUpAt };
  }

  it("is edited with the technician and the pick-up moment untouched, and stays Opgepikt", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId, task, pickedUpAt } = await pickedUpTask(tx);
      for (const assigneeId of [null, kevin]) {
        const current = (await queryTaskDetail(tx, task.number))!.version;
        const outcome = await updateTaskInTransaction(tx, {
          actor: sofie(office),
          data: edited({ number: task.number, version: current }, { customerId, assigneeId }),
        });
        expect(outcome).toMatchObject({ kind: "updated", status: "picked_up" });
      }
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "picked_up",
        assigneeId: kevin,
        pickedUpAt,
        instructions: "Aangepast\nTweede regel",
        scheduledDate: "2030-04-01",
      });
    });
  });

  it("refuses another technician (that is Terugzetten) and saves nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId, task } = await pickedUpTask(tx);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: jens }),
      });
      expect(outcome).toEqual({ kind: "assignee-locked" });
      expect(await readTask(tx, task.id)).toMatchObject({
        status: "picked_up",
        assigneeId: kevin,
        instructions: "Jaarlijks onderhoud",
      });
    });
  });
});

describe("updateTaskInTransaction: refusing", () => {
  it("does not find a task that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(
          { number: 2147483647, version: "2030-01-01 00:00:00+00" },
          { customerId, assigneeId: null },
        ),
      });
      expect(outcome).toEqual({ kind: "not-found" });
    });
  });

  it.each([["completed"], ["invoiced"], ["cancelled"]] as const)(
    "refuses a %s task, whatever the version, and changes nothing",
    async (status) => {
      await inRolledBackTransaction(async (tx) => {
        const { office, kevin, customerId } = await setUpBasic(tx);
        const task = await seedTask(tx, office, customerId, kevin);
        const now = new Date();
        await tx
          .update(schema.tasks)
          .set({
            status,
            pickedUpAt: status === "cancelled" ? null : now,
            invoicedAt: status === "invoiced" ? now : null,
            invoicedBy: status === "invoiced" ? office : null,
            cancelledAt: status === "cancelled" ? now : null,
            cancelledBy: status === "cancelled" ? office : null,
          })
          .where(eq(schema.tasks.id, task.id));

        for (const version of [task.version, (await queryTaskDetail(tx, task.number))!.version]) {
          const outcome = await updateTaskInTransaction(tx, {
            actor: sofie(office),
            data: edited({ number: task.number, version }, { customerId, assigneeId: null }),
          });
          expect(outcome).toEqual({ kind: "not-editable", status });
        }
        expect(await readTask(tx, task.id)).toMatchObject({ status, assigneeId: kevin });
        expect((await readTask(tx, task.id)).instructions).toBe("Jaarlijks onderhoud");
      });
    },
  );

  it("refuses a version that is not the current one, and saves nothing (not even a new customer)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(
          { number: task.number, version: "2020-01-01 00:00:00+00" },
          {
            customerId,
            customer: {
              kind: "new",
              data: {
                name: "Spook klant",
                phone: null,
                email: null,
                notes: null,
                street: "x 1",
                postalCode: "9000",
                city: "Gent",
              },
            },
          },
        ),
      });
      expect(outcome).toEqual({ kind: "changed" });
      expect((await readTask(tx, task.id)).instructions).toBe("Jaarlijks onderhoud");
      const ghosts = await tx.execute<{ total: number }>(
        sql`select count(*)::int as total from public.customers where name = 'Spook klant'`,
      );
      expect(ghosts[0].total).toBe(0);
    });
  });

  it("notices a change of one microsecond (the version is not rounded to milliseconds)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      await tx.execute(
        sql`update public.tasks set updated_at = updated_at + interval '1 microsecond' where id = ${task.id}`,
      );
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: null }),
      });
      expect(outcome).toEqual({ kind: "changed" });
    });
  });

  it("refuses a customer that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, {
          customerId,
          customer: { kind: "existing", id: "00000000-0000-4000-8000-000000000000" },
        }),
      });
      expect(outcome).toEqual({ kind: "customer-not-found" });
    });
  });

  it("refuses a technician who is switched off, with his name, and keeps the old assignment", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const bram = await createProfile(tx, "Bram Claes", { isActive: false });
      const task = await seedTask(tx, office, customerId, kevin);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: bram }),
      });
      expect(outcome).toEqual({ kind: "assignee-inactive", fullName: "Bram Claes" });
      expect(await readTask(tx, task.id)).toMatchObject({ assigneeId: kevin });
    });
  });

  it("refuses an invited technician who did not choose a password yet", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const yana = await createProfile(tx, "Yana Willems", { invitePending: true });
      const task = await seedTask(tx, office, customerId, null);
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: yana }),
      });
      expect(outcome).toEqual({ kind: "assignee-invited", fullName: "Yana Willems" });
      expect(await readTask(tx, task.id)).toMatchObject({ status: "open", assigneeId: null });
    });
  });

  it("refuses an unknown id and a user who is no technician, with the same outcome", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, other, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      for (const assigneeId of ["00000000-0000-4000-8000-000000000000", other]) {
        const outcome = await updateTaskInTransaction(tx, {
          actor: sofie(office),
          data: edited(task, { customerId, assigneeId }),
        });
        expect(outcome).toEqual({ kind: "assignee-not-found" });
      }
    });
  });

  it("refuses an actor who is not backoffice, through the transition rules", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const outcome = await updateTaskInTransaction(tx, {
        actor: { id: kevin, role: "technician", isActive: true },
        data: edited(task, { customerId, assigneeId: jens }),
      });
      expect(outcome).toEqual({ kind: "refused", reason: "wrong_role" });
      expect(await readTask(tx, task.id)).toMatchObject({ assigneeId: kevin });
    });
  });
});

describe("the updated_at trigger (ADR-0003)", () => {
  const readVersion = async (tx: Tx, number: number) =>
    (await queryTaskDetail(tx, number))!.version;

  it("changes the version on a raw SQL update that does not mention updated_at", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      await tx.execute(sql`update public.tasks set instructions = 'Raw' where id = ${task.id}`);
      expect(await readVersion(tx, task.number)).not.toBe(task.version);
    });
  });

  it("overrides an updated_at that the writer gives, and never goes back", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      await tx.execute(
        sql`update public.tasks set updated_at = '2000-01-01T00:00:00Z' where id = ${task.id}`,
      );
      const first = await readVersion(tx, task.number);
      expect(first > task.version).toBe(true);
      // A new update right after: strictly greater, also within one transaction (one now()).
      await tx.execute(sql`update public.tasks set instructions = 'Twee' where id = ${task.id}`);
      expect((await readVersion(tx, task.number)) > first).toBe(true);
    });
  });

  it("changes the version even for an update that changes nothing, and leaves other rows alone", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const one = await seedTask(tx, office, customerId, null);
      const two = await seedTask(tx, office, customerId, null);
      await tx.execute(sql`update public.tasks set status = status where id = ${one.id}`);
      expect(await readVersion(tx, one.number)).not.toBe(one.version);
      expect(await readVersion(tx, two.number)).toBe(two.version);
    });
  });

  it("makes an open form 'changed' after a raw SQL update by another writer", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      await tx.execute(
        sql`update public.tasks set instructions = 'Van een script' where id = ${task.id}`,
      );
      const outcome = await updateTaskInTransaction(tx, {
        actor: sofie(office),
        data: edited(task, { customerId, assigneeId: null }),
      });
      expect(outcome).toEqual({ kind: "changed" });
      expect((await readTask(tx, task.id)).instructions).toBe("Van een script");
    });
  });

  it("does not change created_at, and the trigger is on the table", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, null);
      const before = await readTask(tx, task.id);
      await tx.execute(sql`update public.tasks set instructions = 'x' where id = ${task.id}`);
      expect((await readTask(tx, task.id)).createdAt).toEqual(before.createdAt);
      const triggers = await tx.execute<{ tgname: string }>(
        sql`select tgname from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal`,
      );
      expect(triggers.map((row) => row.tgname)).toContain("tasks_set_updated_at");
    });
  });
});

describe("queryTaskDetail", () => {
  it("reads the task with customer, technician, creator and the numbers of the timeline", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const detail = await queryTaskDetail(tx, task.number);
      expect(detail).toMatchObject({
        id: task.id,
        number: task.number,
        status: "assigned",
        workType: "maintenance",
        scheduledDate: "2030-03-15",
        startTime: "14:15:00",
        locationCity: "Rijkevorsel",
        customer: { id: customerId, name: "Klant", street: "Klantstraat 1", city: "Antwerpen" },
        assignee: { id: kevin, fullName: "Kevin Wouters" },
        createdByName: "Sofie Peeters",
        completion: null,
        cancelledAt: null,
      });
    });
  });

  it("returns null for a number that does not exist", async () => {
    expect(await queryTaskDetail(db, 2147483647)).toBeNull();
  });

  it("reads the completion with the correction, and who did what", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      const now = new Date();
      await tx
        .update(schema.tasks)
        .set({
          status: "invoiced",
          pickedUpAt: now,
          invoicedAt: now,
          invoicedBy: office,
        })
        .where(eq(schema.tasks.id, task.id));
      await tx.insert(schema.taskCompletions).values({
        taskId: task.id,
        workedMinutes: 120,
        notes: "Filter vervangen",
        completedBy: kevin,
        correctedMinutes: 90,
        correctionReason: "Wachttijd",
        correctedBy: office,
        correctedAt: now,
      });
      const detail = await queryTaskDetail(tx, task.number);
      expect(detail).toMatchObject({
        status: "invoiced",
        invoicedByName: "Sofie Peeters",
        completion: {
          workedMinutes: 120,
          notes: "Filter vervangen",
          completedByName: "Kevin Wouters",
          correctedMinutes: 90,
          correctionReason: "Wachttijd",
          correctedByName: "Sofie Peeters",
        },
      });
    });
  });

  it("reads a cancelled task with who, when and why, and the technician it had", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, customerId } = await setUpBasic(tx);
      const task = await seedTask(tx, office, customerId, kevin);
      await tx
        .update(schema.tasks)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: office,
          cancellationReason: "Klant zegt af",
        })
        .where(eq(schema.tasks.id, task.id));
      expect(await queryTaskDetail(tx, task.number)).toMatchObject({
        status: "cancelled",
        cancelledByName: "Sofie Peeters",
        cancellationReason: "Klant zegt af",
        assignee: { fullName: "Kevin Wouters" },
      });
    });
  });
});

// The next tests need two connections that see each other's locks, so their data is committed
// and removed again afterwards.
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

/** Commits a task with a technician, to be used by two connections. */
async function setUpRace() {
  await removeTestData();
  const office = await createProfile(db, "Race Office", { role: "backoffice" });
  const other = await createProfile(db, "Race Other", { role: "backoffice" });
  const kevin = await createProfile(db, "Race Kevin");
  const jens = await createProfile(db, "Race Jens");
  const customerId = await createCustomer(db, office);
  const task = await seedTask(db, office, customerId, kevin);
  return { office, other, kevin, jens, customerId, task };
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

describe("updateTaskInTransaction: two people at the same moment", () => {
  it("two edits of the same form: the second waits, then sees the new version and is refused (no lost update)", async () => {
    const { office, other, kevin, jens, customerId, task } = await setUpRace();
    try {
      const first = holdOpen((tx) =>
        updateTaskInTransaction(tx, {
          actor: sofie(office),
          data: edited(task, { customerId, assigneeId: jens, instructions: "Van Sofie" }),
        }),
      );
      await first.isReady;

      let finished = false;
      const second = db
        .transaction((tx) =>
          updateTaskInTransaction(tx, {
            actor: sofie(other),
            data: edited(task, { customerId, assigneeId: kevin, instructions: "Van Els" }),
          }),
        )
        .finally(() => (finished = true));
      await sleep(400);
      // The second edit waits for the lock instead of overwriting.
      expect(finished).toBe(false);

      first.release();
      expect(await first.result).toMatchObject({ kind: "updated", status: "assigned" });
      expect(await second).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({
        instructions: "Van Sofie",
        assigneeId: jens,
        updatedBy: office,
      });
    } finally {
      await removeTestData();
    }
  });

  it("an edit that was opened before the technician picked the task up is refused, and the pick-up stays", async () => {
    const { office, kevin, customerId, task } = await setUpRace();
    try {
      // The technician picks up (the trigger of ADR-0003 moves updated_at, whoever writes).
      await db
        .update(schema.tasks)
        .set({ status: "picked_up", pickedUpAt: new Date() })
        .where(eq(schema.tasks.id, task.id));

      const outcome = await db.transaction((tx) =>
        updateTaskInTransaction(tx, {
          actor: sofie(office),
          data: edited(task, { customerId, assigneeId: null }),
        }),
      );
      expect(outcome).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "picked_up", assigneeId: kevin });
    } finally {
      await removeTestData();
    }
  });

  it("an edit waits for a pick-up that is under way, and then does not overwrite it", async () => {
    const { office, kevin, customerId, task } = await setUpRace();
    try {
      const pickUp = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "picked_up", pickedUpAt: new Date() })
          .where(eq(schema.tasks.id, task.id));
      });
      await pickUp.isReady;

      let finished = false;
      const editing = db
        .transaction((tx) =>
          updateTaskInTransaction(tx, {
            actor: sofie(office),
            data: edited(task, { customerId, assigneeId: null }),
          }),
        )
        .finally(() => (finished = true));
      await sleep(400);
      expect(finished).toBe(false);

      pickUp.release();
      await pickUp.result;
      expect(await editing).toEqual({ kind: "changed" });
      expect(await readTask(db, task.id)).toMatchObject({ status: "picked_up", assigneeId: kevin });
    } finally {
      await removeTestData();
    }
  });

  it("an edit waits for a cancellation that is under way, and is then refused as not editable", async () => {
    const { office, customerId, task } = await setUpRace();
    try {
      const cancel = holdOpen(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: office })
          .where(eq(schema.tasks.id, task.id));
      });
      await cancel.isReady;

      const editing = db.transaction((tx) =>
        updateTaskInTransaction(tx, {
          actor: sofie(office),
          data: edited(task, { customerId, assigneeId: null }),
        }),
      );
      await sleep(300);
      cancel.release();
      await cancel.result;
      expect(await editing).toEqual({ kind: "not-editable", status: "cancelled" });
      expect((await readTask(db, task.id)).status).toBe("cancelled");
    } finally {
      await removeTestData();
    }
  });
});

describe("updateTaskInTransaction: a technician switched off at the same moment", () => {
  it("waits for a switch-off that is under way, and then sees the technician as switched off", async () => {
    const { office, jens, customerId, task } = await setUpRace();
    try {
      // Jens has no tasks, so his switch-off goes through.
      const switchOff = holdOpen((tx) => deactivateTechnicianProfile(tx, jens));
      await switchOff.isReady;

      let finished = false;
      const editing = db
        .transaction((tx) =>
          updateTaskInTransaction(tx, {
            actor: sofie(office),
            data: edited(task, { customerId, assigneeId: jens }),
          }),
        )
        .finally(() => (finished = true));
      await sleep(400);
      expect(finished).toBe(false);

      switchOff.release();
      expect(await switchOff.result).toMatchObject({ kind: "deactivated" });
      expect(await editing).toEqual({ kind: "assignee-inactive", fullName: "Race Jens" });
      expect((await readTask(db, task.id)).assigneeId).not.toBe(jens);
    } finally {
      await removeTestData();
    }
  });

  it("makes a switch-off wait for an assignment that is being saved, and then counts that task", async () => {
    const { office, jens, customerId, task } = await setUpRace();
    try {
      const assigning = holdOpen((tx) =>
        updateTaskInTransaction(tx, {
          actor: sofie(office),
          data: edited(task, { customerId, assigneeId: jens }),
        }),
      );
      await assigning.isReady;

      let finished = false;
      const switchOff = db
        .transaction((tx) => deactivateTechnicianProfile(tx, jens))
        .finally(() => (finished = true));
      await sleep(400);
      expect(finished).toBe(false);

      assigning.release();
      expect(await assigning.result).toMatchObject({ kind: "updated", status: "assigned" });
      expect(await switchOff).toEqual({ kind: "open-tasks", fullName: "Race Jens", openTasks: 1 });
      const [profile] = await db
        .select({ isActive: schema.profiles.isActive })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, jens));
      expect(profile.isActive).toBe(true);
    } finally {
      await removeTestData();
    }
  });
});
