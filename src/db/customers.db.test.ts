import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryCustomerDetail, queryCustomerList } from "@/lib/customers/list";
import { queryCustomerById } from "@/lib/customers/lookup";
import { insertCustomer, updateCustomerFields } from "@/lib/customers/save";
import { findCustomers } from "@/lib/customers/search";
import type { CustomerInput } from "@/lib/validation/customer";

import type { Database } from "./client";

// The customer screens of BT-18 against the real database (local Supabase in CI): the search on
// phone numbers without spaces (picker and list), the list with the number of tasks and the
// latest task, the customer with his tasks, saving and the foreign key from tasks. Everything
// runs in a transaction that is always rolled back. The database may hold other customers, so
// every check looks at the customers of this test only, by a unique text in their names.
vi.mock("server-only", () => ({}));

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Start the local Supabase (`supabase start`) and set DATABASE_URL.",
  );
}

class Rollback extends Error {}

let client: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

beforeAll(() => {
  client = postgres(url!, { max: 1, prepare: false });
  db = drizzle(client, { schema });
});

afterAll(async () => {
  await client.end();
});

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

/** A text that only the customers of this test contain. */
const TOKEN = "Zqxklant18";

async function createProfile(tx: Tx, name: string, role = "backoffice"): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@customers-test.example`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role)
    values (${user.id}, ${name}, ${email}, ${role})
  `);
  return user.id;
}

const asDb = (tx: Tx) => tx as unknown as Database;

function customerData(overrides: Partial<CustomerInput> = {}): CustomerInput {
  return {
    name: `${TOKEN} Bakkerij`,
    street: null,
    postalCode: null,
    city: null,
    phone: null,
    email: null,
    notes: null,
    ...overrides,
  };
}

async function createTask(
  tx: Tx,
  office: string,
  customerId: string,
  spec: {
    date: string;
    time?: string;
    status?: "open" | "assigned" | "picked_up" | "completed" | "invoiced" | "cancelled";
    assignee?: string;
    instructions?: string;
  },
): Promise<number> {
  const status = spec.status ?? "open";
  const stamp = "2026-11-23T07:48:00Z";
  const pickedUp = ["picked_up", "completed", "invoiced"].includes(status);
  const [task] = await tx.execute<{ number: number }>(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, cancelled_at, cancelled_by,
      invoiced_at, invoiced_by, created_by, updated_by
    ) values (
      ${customerId}, 'Straat 1', '9000', 'Gent', 'repair', ${spec.instructions ?? "Herstellen"},
      ${spec.date}, ${spec.time ?? "09:00"}, ${spec.assignee ?? null}, ${status},
      ${pickedUp ? stamp : null}, ${status === "cancelled" ? stamp : null},
      ${status === "cancelled" ? office : null}, ${status === "invoiced" ? stamp : null},
      ${status === "invoiced" ? office : null},
      ${office}, ${office}
    ) returning number
  `);
  return task.number;
}

describe("searching customers by phone number (BT-08 follow-up)", () => {
  it("finds a number with spaces by the same digits typed without spaces, and the other way round", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const spaced = await insertCustomer(
        tx,
        office,
        customerData({ name: `${TOKEN} Met spaties`, phone: "014 41 22 87" }),
      );
      const plain = await insertCustomer(
        tx,
        office,
        customerData({ name: `${TOKEN} Zonder spaties`, phone: "0485331908" }),
      );

      const ids = async (text: string) =>
        (await findCustomers(asDb(tx), text)).map((customer) => customer.id);

      expect(await ids("014412287")).toEqual([spaced]);
      expect(await ids("014 41 22 87")).toEqual([spaced]);
      expect(await ids(" 014 4122 87 ")).toEqual([spaced]);
      expect(await ids("0144 12")).toEqual([spaced]);
      expect(await ids("0485 33 19 08")).toEqual([plain]);
      expect(await ids("485331")).toEqual([plain]);
      expect(await ids("0144 13")).toEqual([]);
    });
  });

  it("ignores a non-breaking space and other white space in the stored number and in the text", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(tx, office, customerData({ phone: "014\u00a041\t22 87" }));
      const ids = async (text: string) =>
        (await findCustomers(asDb(tx), text)).map((customer) => customer.id);
      expect(await ids("014412287")).toEqual([id]);
      expect(await ids("014\u00a041 22")).toEqual([id]);
      expect(await ids("0144\t12")).toEqual([id]);
    });
  });

  it("still searches the name and the city with the spaces that were typed", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(
        tx,
        office,
        customerData({ name: `${TOKEN} De Gouden Korst`, city: "Sint Niklaas" }),
      );
      const ids = async (text: string) =>
        (await findCustomers(asDb(tx), text)).map((customer) => customer.id);
      expect(await ids(`${TOKEN} de gouden`)).toEqual([id]);
      expect(await ids("sint niklaas")).toContain(id);
      // A text that is only letters does not find a customer through the phone number.
      expect(await ids(`${TOKEN} degouden`)).toEqual([]);
    });
  });

  it("takes % and _ literally in a phone number search", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      await insertCustomer(tx, office, customerData({ phone: "014 41 22 87" }));
      expect(await findCustomers(asDb(tx), "0144%")).toEqual([]);
      expect(await findCustomers(asDb(tx), "0144_2")).toEqual([]);
    });
  });

  it("does the same in the customer list (B5)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(
        tx,
        office,
        customerData({ name: `${TOKEN} Lijst`, phone: "014 41 22 87" }),
      );
      for (const q of ["014412287", "014 41 22 87", "4122"]) {
        const list = await queryCustomerList(asDb(tx), { q, page: 1 });
        expect(list.rows.map((row) => row.id)).toContain(id);
      }
    });
  });
});

describe("the customer list (B5)", () => {
  it("counts every task, and gives the day of the latest task that was carried out", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const kevin = await createProfile(tx, "Kevin Wouters", "technician");
      const busy = await insertCustomer(tx, office, customerData({ name: `${TOKEN} Druk` }));
      const planned = await insertCustomer(tx, office, customerData({ name: `${TOKEN} Gepland` }));
      const quiet = await insertCustomer(tx, office, customerData({ name: `${TOKEN} Rustig` }));
      await createTask(tx, office, busy, {
        date: "2026-10-01",
        status: "invoiced",
        assignee: kevin,
      });
      await createTask(tx, office, busy, {
        date: "2026-11-20",
        status: "completed",
        assignee: kevin,
      });
      // These do not count as "carried out": later cancelled, planned, open or still busy.
      await createTask(tx, office, busy, { date: "2026-12-05", status: "cancelled" });
      await createTask(tx, office, busy, { date: "2027-01-10" });
      await createTask(tx, office, busy, {
        date: "2026-11-25",
        status: "picked_up",
        assignee: kevin,
      });
      await createTask(tx, office, planned, { date: "2026-12-05", status: "cancelled" });
      await createTask(tx, office, planned, { date: "2027-01-10" });

      const list = await queryCustomerList(asDb(tx), { q: TOKEN, page: 1 });
      expect(list.rows.map((row) => [row.name, row.taskCount, row.lastTaskDate])).toEqual([
        [`${TOKEN} Druk`, 5, "2026-11-20"],
        [`${TOKEN} Gepland`, 2, null],
        [`${TOKEN} Rustig`, 0, null],
      ]);
      expect(list.rows.map((row) => row.id)).toEqual([busy, planned, quiet]);
      expect(list.total).toBe(3);
      expect(list.pageCount).toBe(1);
      expect(list.hasAnyCustomer).toBe(true);
    });
  });

  it("does not multiply customers or tasks when a customer has many tasks", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(tx, office, customerData());
      for (let day = 10; day < 16; day++) {
        await createTask(tx, office, id, { date: `2026-11-${day}` });
      }
      const list = await queryCustomerList(asDb(tx), { q: TOKEN, page: 1 });
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0].taskCount).toBe(6);
      expect(list.total).toBe(1);
    });
  });

  it("searches name, city and phone number (any case) and sorts by name without regard to case", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const zeta = await insertCustomer(tx, office, customerData({ name: `${TOKEN} zeta` }));
      const alpha = await insertCustomer(
        tx,
        office,
        customerData({ name: `${TOKEN} Alpha`, city: "Zqxstad" }),
      );
      const beta = await insertCustomer(
        tx,
        office,
        customerData({ name: `${TOKEN} Beta`, phone: "0999 11 22 33" }),
      );
      const all = await queryCustomerList(asDb(tx), { q: TOKEN.toUpperCase(), page: 1 });
      expect(all.rows.map((row) => row.id)).toEqual([alpha, beta, zeta]);
      const byCity = await queryCustomerList(asDb(tx), { q: "zqxSTAD", page: 1 });
      expect(byCity.rows.map((row) => row.id)).toEqual([alpha]);
      const byPhone = await queryCustomerList(asDb(tx), { q: "099911", page: 1 });
      expect(byPhone.rows.map((row) => row.id)).toEqual([beta]);
      const none = await queryCustomerList(asDb(tx), { q: `${TOKEN} bestaatniet`, page: 1 });
      expect(none).toMatchObject({ rows: [], total: 0, pageCount: 1, hasAnyCustomer: true });
    });
  });

  it("shows the last page for a page that is too high", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      await insertCustomer(tx, office, customerData());
      const list = await queryCustomerList(asDb(tx), { q: TOKEN, page: 99 });
      expect(list.params.page).toBe(1);
      expect(list.rows).toHaveLength(1);
    });
  });

  it("pages after 50 customers", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      for (let index = 0; index < 51; index++) {
        await insertCustomer(
          tx,
          office,
          customerData({ name: `${TOKEN} ${String(index).padStart(2, "0")}` }),
        );
      }
      const first = await queryCustomerList(asDb(tx), { q: TOKEN, page: 1 });
      const second = await queryCustomerList(asDb(tx), { q: TOKEN, page: 2 });
      expect(first.rows).toHaveLength(50);
      expect(first.total).toBe(51);
      expect(first.pageCount).toBe(2);
      expect(second.rows.map((row) => row.name)).toEqual([`${TOKEN} 50`]);
    });
  });
});

describe("the customer with his tasks (B6)", () => {
  it("returns the fields and every task, newest first, with the technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const kevin = await createProfile(tx, "Kevin Wouters", "technician");
      const id = await insertCustomer(
        tx,
        office,
        customerData({ city: "Turnhout", email: "info@x.be", notes: "Achterdeur" }),
      );
      const other = await insertCustomer(tx, office, customerData({ name: `${TOKEN} Andere` }));
      const old = await createTask(tx, office, id, { date: "2026-10-01" });
      const morning = await createTask(tx, office, id, {
        date: "2026-11-23",
        time: "08:00",
        status: "assigned",
        assignee: kevin,
        instructions: "Onderhoud\nTweede regel",
      });
      const afternoon = await createTask(tx, office, id, {
        date: "2026-11-23",
        time: "14:00",
        status: "cancelled",
      });
      await createTask(tx, office, other, { date: "2026-11-30" });

      const detail = await queryCustomerDetail(asDb(tx), id);
      expect(detail).toMatchObject({
        id,
        name: `${TOKEN} Bakkerij`,
        city: "Turnhout",
        email: "info@x.be",
        notes: "Achterdeur",
      });
      expect(detail?.tasks.map((task) => task.number)).toEqual([afternoon, morning, old]);
      expect(detail?.tasks.map((task) => task.status)).toEqual(["cancelled", "assigned", "open"]);
      expect(detail?.tasks[1]).toMatchObject({
        technicianName: "Kevin Wouters",
        instructions: "Onderhoud\nTweede regel",
        scheduledDate: "2026-11-23",
        workType: "repair",
      });
      expect(detail?.tasks[0].technicianName).toBeNull();
    });
  });

  it("returns null for a customer that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      expect(
        await queryCustomerDetail(asDb(tx), "00000000-0000-4000-8000-000000000000"),
      ).toBeNull();
    });
  });

  it("finds a customer by id for 'Nieuwe taak voor deze klant'", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(
        tx,
        office,
        customerData({ street: "Gasthuisstraat 23", postalCode: "2300", city: "Turnhout" }),
      );
      expect(await queryCustomerById(asDb(tx), id)).toEqual({
        id,
        name: `${TOKEN} Bakkerij`,
        street: "Gasthuisstraat 23",
        postalCode: "2300",
        city: "Turnhout",
        phone: null,
      });
      expect(await queryCustomerById(asDb(tx), "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});

describe("saving customers", () => {
  it("saves a new customer for the user, with a null for every empty field", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(tx, office, customerData({ phone: "014 41 22 87" }));
      const [row] = await tx.execute<Record<string, unknown>>(
        sql`select name, street, phone, email, created_by from public.customers where id = ${id}`,
      );
      expect(row).toMatchObject({
        name: `${TOKEN} Bakkerij`,
        street: null,
        phone: "014 41 22 87",
        email: null,
        created_by: office,
      });
    });
  });

  it("changes the fields, keeps who made the customer, and leaves the location of the tasks alone", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const other = await createProfile(tx, "Els Janssens");
      const id = await insertCustomer(tx, office, customerData({ city: "Turnhout" }));
      const number = await createTask(tx, office, id, { date: "2026-11-23" });
      const [before] = await tx.execute<{ created_at: string; updated_at: string }>(
        sql`select created_at, updated_at from public.customers where id = ${id}`,
      );

      expect(
        await updateCustomerFields(
          tx,
          id,
          customerData({ name: `${TOKEN} Nieuw`, city: "Retie", street: "Kerkstraat 9" }),
        ),
      ).toBe(true);

      const [row] = await tx.execute<Record<string, unknown>>(
        sql`select name, city, street, created_by, created_at, updated_at from public.customers where id = ${id}`,
      );
      expect(row).toMatchObject({
        name: `${TOKEN} Nieuw`,
        city: "Retie",
        street: "Kerkstraat 9",
        created_by: office,
        created_at: before.created_at,
      });
      expect(row.created_by).not.toBe(other);
      expect(String(row.updated_at)).not.toBe(String(before.updated_at));
      // Same transaction, same `now()`: the change of `updated_at` comes from Drizzle's
      // `$onUpdate`, which uses the clock of the application.
      const [task] = await tx.execute<{ location_city: string; location_street: string }>(
        sql`select location_city, location_street from public.tasks where number = ${number}`,
      );
      expect(task).toEqual({ location_city: "Gent", location_street: "Straat 1" });
    });
  });

  it("empties a field that was cleared", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(tx, office, customerData({ phone: "014 41 22 87" }));
      await updateCustomerFields(tx, id, customerData({ phone: null }));
      const [row] = await tx.execute<{ phone: string | null }>(
        sql`select phone from public.customers where id = ${id}`,
      );
      expect(row.phone).toBeNull();
    });
  });

  it("returns false for a customer that does not exist, and changes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      expect(
        await updateCustomerFields(tx, "00000000-0000-4000-8000-000000000000", customerData()),
      ).toBe(false);
    });
  });

  it("cannot delete a customer that has tasks (the foreign key restricts it)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters");
      const id = await insertCustomer(tx, office, customerData());
      await createTask(tx, office, id, { date: "2026-11-23" });
      await expect(
        tx.transaction((nested) =>
          nested.execute(sql`delete from public.customers where id = ${id}`),
        ),
      ).rejects.toMatchObject({ cause: { code: "23503" } });
    });
  });
});
