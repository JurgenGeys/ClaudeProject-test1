import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTaskOverview } from "@/lib/tasks/overview";
import type { TaskOverviewFilters } from "@/lib/validation/task-overview";

import type { Database } from "./client";

// The task overview of B1 (BT-09) against the real database (local Supabase in CI): the counts
// per tab, the filters on technician and period, the order and the hours that count. Everything
// runs in a transaction that is always rolled back. The database may hold other tasks (other
// tests, a developer's data), so every check looks at the tasks of this test only, by customer.
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

const CUSTOMER = "Overzicht-testklant";

async function createProfile(
  tx: Tx,
  name: string,
  fields: { role?: string; isActive?: boolean; invitePending?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@overview-test.example`;
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

type TaskSpec = {
  status: string;
  date: string;
  time?: string;
  assignee?: string | null;
  instructions?: string;
  city?: string;
  /** Worked minutes, for completed and invoiced tasks; `corrected` is the corrected value. */
  worked?: number;
  corrected?: number;
  /** When it was completed (`task_completions.completed_at`); the database default when absent. */
  completedAt?: string;
};

/** A task that obeys the check constraints of its status. Returns its number. */
async function createTask(
  tx: Tx,
  office: string,
  customerId: string,
  spec: TaskSpec,
): Promise<number> {
  const { status } = spec;
  const stamp = "2026-11-23T07:48:00Z";
  const pickedUp = ["picked_up", "completed", "invoiced"].includes(status);
  const [task] = await tx.execute<{ id: string; number: number }>(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, cancelled_at, cancelled_by,
      invoiced_at, invoiced_by, created_by, updated_by
    ) values (
      ${customerId}, 'Straat 1', '9000', ${spec.city ?? "Gent"}, 'maintenance',
      ${spec.instructions ?? "Onderhoud"}, ${spec.date}, ${spec.time ?? "09:00"},
      ${spec.assignee ?? null}, ${status}, ${pickedUp ? stamp : null},
      ${status === "cancelled" ? stamp : null}, ${status === "cancelled" ? office : null},
      ${status === "invoiced" ? stamp : null}, ${status === "invoiced" ? office : null},
      ${office}, ${office}
    ) returning id, number
  `);
  if (spec.worked !== undefined) {
    await tx.execute(sql`
      insert into public.task_completions (task_id, worked_minutes, completed_by, completed_at,
        corrected_minutes, correction_reason, corrected_by, corrected_at)
      values (${task.id}, ${spec.worked}, ${spec.assignee}, coalesce(${spec.completedAt ?? null}::timestamptz, now()),
        ${spec.corrected ?? null}, ${spec.corrected ? "Klant bevestigde" : null},
        ${spec.corrected ? office : null}, ${spec.corrected ? stamp : null})
    `);
  }
  return task.number;
}

const noFilters: TaskOverviewFilters = {
  tab: "active",
  technician: null,
  from: null,
  to: null,
  page: 1,
};

/** The overview, but only the tasks that this test made. */
async function overviewOf(tx: Tx, numbers: number[], filters: Partial<TaskOverviewFilters> = {}) {
  const result = await queryTaskOverview(tx as unknown as Database, { ...noFilters, ...filters });
  return { ...result, rows: result.rows.filter((row) => numbers.includes(row.number)) };
}

/** A set of tasks over every status, two technicians and several days. */
async function seed(tx: Tx) {
  const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
  const kevin = await createProfile(tx, "Kevin Wouters");
  const jens = await createProfile(tx, "Jens Maes");
  const [customer] = await tx.execute<{ id: string }>(
    sql`insert into public.customers (name, created_by) values (${CUSTOMER}, ${office}) returning id`,
  );
  const make = (spec: TaskSpec) => createTask(tx, office, customer.id, spec);
  const t = {
    open: await make({ status: "open", date: "2026-11-26", time: "09:00" }),
    assignedKevin: await make({
      status: "assigned",
      date: "2026-11-24",
      time: "14:00",
      assignee: kevin,
      instructions: "Eerste regel\nTweede regel",
      city: "Turnhout",
    }),
    assignedKevinEarlier: await make({
      status: "assigned",
      date: "2026-11-24",
      time: "09:00",
      assignee: kevin,
    }),
    assignedJens: await make({ status: "assigned", date: "2026-12-05", assignee: jens }),
    pickedUp: await make({ status: "picked_up", date: "2026-11-23", assignee: kevin }),
    completed: await make({
      status: "completed",
      date: "2026-11-20",
      assignee: jens,
      worked: 120,
      completedAt: "2026-11-24T10:00:00Z",
    }),
    completedCorrected: await make({
      status: "completed",
      date: "2026-11-21",
      assignee: kevin,
      worked: 120,
      corrected: 90,
      completedAt: "2026-11-23T09:00:00Z",
    }),
    invoiced: await make({ status: "invoiced", date: "2026-11-10", assignee: kevin, worked: 60 }),
    cancelled: await make({ status: "cancelled", date: "2026-11-25", assignee: kevin }),
    cancelledUnassigned: await make({ status: "cancelled", date: "2026-11-27" }),
  };
  return { office, kevin, jens, customerId: customer.id, t, numbers: Object.values(t) };
}

describe("queryTaskOverview", () => {
  it("counts per tab: Actief without Gefactureerd and Geannuleerd, Alle with everything", async () => {
    await inRolledBackTransaction(async (tx) => {
      // The database may hold other tasks, so measure before and after the seed.
      const before = (await queryTaskOverview(tx as unknown as Database, noFilters)).counts;
      await seed(tx);
      const after = (await queryTaskOverview(tx as unknown as Database, noFilters)).counts;
      const added = Object.fromEntries(
        Object.keys(after).map((tab) => [
          tab,
          after[tab as keyof typeof after] - before[tab as keyof typeof before],
        ]),
      );
      expect(added).toEqual({
        active: 7, // 1 open + 3 assigned + 1 picked up + 2 completed
        open: 1,
        assigned: 3,
        picked_up: 1,
        completed: 2,
        invoiced: 1,
        cancelled: 2,
        all: 10,
      });
    });
  });

  it("shows the tasks of each tab", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers } = await seed(tx);
      const rowsOf = (tab: TaskOverviewFilters["tab"]) =>
        overviewOf(tx, numbers, { tab }).then((r) => r.rows.length);
      expect(await rowsOf("open")).toBe(1);
      expect(await rowsOf("assigned")).toBe(3);
      expect(await rowsOf("picked_up")).toBe(1);
      expect(await rowsOf("completed")).toBe(2);
      expect(await rowsOf("invoiced")).toBe(1);
      expect(await rowsOf("cancelled")).toBe(2);
      expect(await rowsOf("active")).toBe(7);
      expect(await rowsOf("all")).toBe(10);
    });
  });

  it("keeps cancelled tasks out of Actief", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, t } = await seed(tx);
      const { rows } = await overviewOf(tx, numbers);
      const shown = rows.map((row) => row.number);
      expect(shown).not.toContain(t.cancelled);
      expect(shown).not.toContain(t.cancelledUnassigned);
      expect(shown).not.toContain(t.invoiced);
    });
  });

  it("sorts the oldest first, by day and then start time, except for Afgewerkt, Gefactureerd and Geannuleerd", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, t, office, kevin, customerId } = await seed(tx);
      const active = await overviewOf(tx, numbers);
      expect(active.rows.map((r) => r.number)).toEqual([
        t.completed, // 20/11
        t.completedCorrected, // 21/11
        t.pickedUp, // 23/11
        t.assignedKevinEarlier, // 24/11 09:00
        t.assignedKevin, // 24/11 14:00
        t.open, // 26/11
        t.assignedJens, // 05/12
      ]);

      // Afgewerkt: by the moment of completing, newest first, not by the planned day (`completed`
      // was planned earlier but completed later). The highest number goes first on a tie.
      const completed = await overviewOf(tx, numbers, { tab: "completed" });
      expect(completed.rows.map((r) => r.number)).toEqual([t.completed, t.completedCorrected]);
      const tie = await createTask(tx, office, customerId, {
        status: "completed",
        date: "2026-11-01",
        assignee: kevin,
        worked: 60,
        completedAt: "2026-11-24T10:00:00Z",
      });
      const withTie = await overviewOf(tx, [...numbers, tie], { tab: "completed" });
      expect(withTie.rows.map((r) => r.number)).toEqual([tie, t.completed, t.completedCorrected]);
      expect(withTie.rows[0].completedAt).toEqual(new Date("2026-11-24T10:00:00Z"));
      const cancelled = await overviewOf(tx, numbers, { tab: "cancelled" });
      expect(cancelled.rows.map((r) => r.number)).toEqual([t.cancelledUnassigned, t.cancelled]);
    });
  });

  it("filters on technician, for the list and for the counts", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, kevin, t } = await seed(tx);
      const result = await overviewOf(tx, numbers, { technician: kevin });
      expect(result.filters.technician).toBe(kevin);
      expect(result.rows.map((r) => r.number).sort()).toEqual(
        [t.pickedUp, t.assignedKevinEarlier, t.assignedKevin, t.completedCorrected].sort(),
      );
      // Kevin has exactly these tasks in the database, so the counts are exact.
      expect(result.counts).toMatchObject({
        open: 0,
        assigned: 2,
        picked_up: 1,
        completed: 1,
        invoiced: 1,
        cancelled: 1,
        active: 4,
        all: 6,
      });
    });
  });

  it("filters on the cancelled tasks of a technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, kevin, t } = await seed(tx);
      const result = await overviewOf(tx, numbers, { tab: "cancelled", technician: kevin });
      expect(result.rows.map((r) => r.number)).toEqual([t.cancelled]);
    });
  });

  it("drops a technician that does not exist instead of showing nothing under 'Alle techniekers'", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers } = await seed(tx);
      const result = await overviewOf(tx, numbers, {
        technician: "6f1c1c7e-4f55-4c3b-9d33-000000000000",
      });
      expect(result.filters.technician).toBeNull();
      expect(result.rows).toHaveLength(7);
    });
  });

  it("filters on the planned day, both ends included", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, t } = await seed(tx);
      const result = await overviewOf(tx, numbers, { from: "2026-11-23", to: "2026-11-24" });
      expect(result.rows.map((r) => r.number)).toEqual([
        t.pickedUp,
        t.assignedKevinEarlier,
        t.assignedKevin,
      ]);
      const from = await overviewOf(tx, numbers, { from: "2026-12-05" });
      expect(from.rows.map((r) => r.number)).toEqual([t.assignedJens]);
      const to = await overviewOf(tx, numbers, { to: "2026-11-20" });
      expect(to.rows.map((r) => r.number)).toEqual([t.completed]);
    });
  });

  it("combines technician, period and tab", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, kevin, t } = await seed(tx);
      const result = await overviewOf(tx, numbers, {
        tab: "assigned",
        technician: kevin,
        from: "2026-11-24",
        to: "2026-11-24",
        page: 1,
      });
      expect(result.rows.map((r) => r.number)).toEqual([t.assignedKevinEarlier, t.assignedKevin]);
    });
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers } = await seed(tx);
      const result = await overviewOf(tx, numbers, { from: "2030-01-01", to: "2030-01-02" });
      expect(result.rows).toEqual([]);
      expect(result.hasAnyTask).toBe(true);
    });
  });

  it("gives the hours that count: the correction when there is one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, t } = await seed(tx);
      const { rows } = await overviewOf(tx, numbers, { tab: "all" });
      const byNumber = new Map(rows.map((row) => [row.number, row]));
      expect(byNumber.get(t.completed)).toMatchObject({ minutes: 120, corrected: false });
      expect(byNumber.get(t.completedCorrected)).toMatchObject({ minutes: 90, corrected: true });
      expect(byNumber.get(t.invoiced)).toMatchObject({ minutes: 60, corrected: false });
      expect(byNumber.get(t.assignedKevin)).toMatchObject({ minutes: null, corrected: false });
    });
  });

  it("gives the technician's name, the city of the place of work, and when it was picked up", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers, t } = await seed(tx);
      const { rows } = await overviewOf(tx, numbers, { tab: "all" });
      const byNumber = new Map(rows.map((row) => [row.number, row]));
      expect(byNumber.get(t.assignedKevin)).toMatchObject({
        technicianName: "Kevin Wouters",
        city: "Turnhout",
        customerName: CUSTOMER,
        instructions: "Eerste regel\nTweede regel",
        startTime: "14:00:00",
        scheduledDate: "2026-11-24",
      });
      expect(byNumber.get(t.open)?.technicianName).toBeNull();
      // A cancelled task keeps its last technician.
      expect(byNumber.get(t.cancelled)?.technicianName).toBe("Kevin Wouters");
      expect(byNumber.get(t.pickedUp)?.pickedUpAt?.toISOString()).toBe("2026-11-23T07:48:00.000Z");
      expect(byNumber.get(t.assignedKevin)?.pickedUpAt).toBeNull();
    });
  });

  it("lists active and switched-off technicians for the filter, not invited ones or backoffice", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      await createProfile(tx, "Kevin Wouters");
      await createProfile(tx, "Yana Willems", { invitePending: true });
      await createProfile(tx, "Tom Hendrickx", { isActive: false });
      const { technicians } = await queryTaskOverview(tx as unknown as Database, noFilters);
      const mine = technicians.filter((t) =>
        ["Kevin Wouters", "Yana Willems", "Tom Hendrickx", "Sofie Peeters"].includes(t.fullName),
      );
      expect(mine.map((t) => [t.fullName, t.isActive])).toEqual([
        ["Kevin Wouters", true],
        ["Tom Hendrickx", false],
      ]);
    });
  });

  it("filters on a switched-off technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const tom = await createProfile(tx, "Tom Hendrickx", { isActive: false });
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into public.customers (name, created_by) values (${CUSTOMER}, ${office}) returning id`,
      );
      const number = await createTask(tx, office, customer.id, {
        status: "completed",
        date: "2026-11-01",
        assignee: tom,
        worked: 60,
      });
      const result = await queryTaskOverview(tx as unknown as Database, {
        ...noFilters,
        technician: tom,
      });
      expect(result.filters.technician).toBe(tom);
      expect(result.rows.map((r) => r.number)).toEqual([number]);
    });
  });

  describe("pages of 50", () => {
    /** `count` assigned tasks for a technician of this test, from 2040-01-01 on, one per day. */
    async function manyTasks(tx: Tx, count: number, instructions = "Onderhoud") {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into public.customers (name, created_by) values (${CUSTOMER}, ${office}) returning id`,
      );
      const numbers: number[] = [];
      for (let i = 0; i < count; i++) {
        const day = String(1 + (i % 28)).padStart(2, "0");
        const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
        numbers.push(
          await createTask(tx, office, customer.id, {
            status: "assigned",
            date: `2040-${month}-${day}`,
            assignee: kevin,
            instructions,
          }),
        );
      }
      return { kevin, numbers };
    }

    const page = (tx: Tx, kevin: string, n: number) =>
      queryTaskOverview(tx as unknown as Database, {
        ...noFilters,
        technician: kevin,
        page: n,
      });

    it("shows 50 per page, the count of the tab stays the total", async () => {
      await inRolledBackTransaction(async (tx) => {
        const { kevin, numbers } = await manyTasks(tx, 120);
        const first = await page(tx, kevin, 1);
        expect(first.rows.map((r) => r.number)).toEqual(numbers.slice(0, 50));
        expect(first).toMatchObject({ page: 1, pageCount: 3 });
        expect(first.counts.active).toBe(120);
        expect(first.counts.assigned).toBe(120);

        const second = await page(tx, kevin, 2);
        expect(second.rows.map((r) => r.number)).toEqual(numbers.slice(50, 100));
        const third = await page(tx, kevin, 3);
        expect(third.rows.map((r) => r.number)).toEqual(numbers.slice(100));
        expect(third.filters.page).toBe(3);
      });
    });

    it("shows the last page for a page that is too high", async () => {
      await inRolledBackTransaction(async (tx) => {
        const { kevin, numbers } = await manyTasks(tx, 51);
        const result = await page(tx, kevin, 99);
        expect(result).toMatchObject({ page: 2, pageCount: 2 });
        expect(result.filters.page).toBe(2);
        expect(result.rows.map((r) => r.number)).toEqual(numbers.slice(50));
      });
    });

    it("has one page for exactly 50 tasks, and for none", async () => {
      await inRolledBackTransaction(async (tx) => {
        const { kevin } = await manyTasks(tx, 50);
        expect(await page(tx, kevin, 1)).toMatchObject({ pageCount: 1 });
        expect((await page(tx, kevin, 2)).rows).toHaveLength(50);
        const none = await queryTaskOverview(tx as unknown as Database, {
          ...noFilters,
          from: "2099-01-01",
          page: 5,
        });
        expect(none).toMatchObject({ page: 1, pageCount: 1, rows: [] });
      });
    });
  });

  it("reads only the start of long instructions", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into public.customers (name, created_by) values (${CUSTOMER}, ${office}) returning id`,
      );
      const number = await createTask(tx, office, customer.id, {
        status: "assigned",
        date: "2040-01-01",
        assignee: kevin,
        instructions: `Eerste regel\n${"x".repeat(4000)}`,
      });
      const { rows } = await overviewOf(tx, [number]);
      expect(rows[0].instructions.length).toBe(300);
      expect(rows[0].instructions.startsWith("Eerste regel\nxxx")).toBe(true);
    });
  });

  it("does not apply a period that ends before it begins", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { numbers } = await seed(tx);
      const result = await overviewOf(tx, numbers, { from: "2026-11-30", to: "2026-11-01" });
      expect(result.periodReversed).toBe(true);
      // The list and the counts are those without a period.
      expect(result.rows).toHaveLength(7);
      expect(result.filters).toMatchObject({ from: "2026-11-30", to: "2026-11-01" });
      const fine = await overviewOf(tx, numbers, { from: "2026-11-01", to: "2026-11-30" });
      expect(fine.periodReversed).toBe(false);
    });
  });
});
