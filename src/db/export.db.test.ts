import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryExportRows } from "@/lib/export/query";
import { queryTaskOverview } from "@/lib/tasks/overview";
import { parseTaskOverviewParams } from "@/lib/validation/task-overview";

// The export query (BT-16) against the real database (local Supabase in CI): which tasks are
// selected (status, period in Belgian time, never cancelled), which hours count, what is read.
// Everything runs in a transaction that is rolled back.
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

let client: postgres.Sql;
let db: Db;
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

async function createProfile(tx: Tx, name: string, role: string): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@export-test.example`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role, is_active, invite_pending)
    values (${user.id}, ${name}, ${email}, ${role}, true, false)
  `);
  return user.id;
}

type Status = "assigned" | "completed" | "invoiced" | "cancelled" | "picked_up";

type Seed = {
  status?: Status;
  /** Moment of completing (UTC instant). */
  completedAt?: string;
  worked?: number;
  corrected?: number;
  scheduledDate?: string;
  notes?: string | null;
  instructions?: string;
};

async function setUp(tx: Tx) {
  const office = await createProfile(tx, "Sofie Peeters", "backoffice");
  const kevin = await createProfile(tx, "Kevin Wouters", "technician");
  const [customer] = await tx.execute<{ id: string }>(sql`
    insert into public.customers (name, phone, email, created_by)
    values ('Exporttest Bakkerij', '014 00 00 00', 'geheim@klant.example', ${office}) returning id
  `);
  return { office, kevin, customerId: customer.id };
}

async function seed(
  tx: Tx,
  ctx: Awaited<ReturnType<typeof setUp>>,
  spec: Seed = {},
): Promise<number> {
  const status = spec.status ?? "completed";
  const stamp = "2026-11-20T07:48:00Z";
  const [task] = await tx.execute<{ id: string; number: number }>(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, invoiced_at, invoiced_by,
      cancelled_at, cancelled_by, created_by, updated_by
    ) values (
      ${ctx.customerId}, 'Gasthuisstraat 23', '2300', 'Turnhout', 'repair',
      ${spec.instructions ?? "Herstelling"}, ${spec.scheduledDate ?? "2033-11-10"}, '09:00',
      ${ctx.kevin}, ${status},
      ${status === "assigned" || status === "cancelled" ? null : stamp},
      ${status === "invoiced" ? stamp : null}, ${status === "invoiced" ? ctx.office : null},
      ${status === "cancelled" ? stamp : null}, ${status === "cancelled" ? ctx.office : null},
      ${ctx.office}, ${ctx.office}
    ) returning id, number
  `);
  if (status === "completed" || status === "invoiced") {
    await tx.insert(schema.taskCompletions).values({
      taskId: task.id,
      workedMinutes: spec.worked ?? 90,
      notes: spec.notes === undefined ? "Filter vervangen" : spec.notes,
      completedBy: ctx.kevin,
      completedAt: new Date(spec.completedAt ?? "2033-11-10T10:00:00Z"),
      ...(spec.corrected !== undefined
        ? {
            correctedMinutes: spec.corrected,
            correctionReason: "pauze niet afgetrokken",
            correctedBy: ctx.office,
            correctedAt: new Date(),
          }
        : {}),
    });
  }
  return task.number;
}

const PERIOD = { from: "2033-11-01", to: "2033-11-30" };

describe("queryExportRows", () => {
  it("returns exactly the columns of the file, with the labels' source values", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      // Planned on the 9th, completed on the 10th: the date in the file is the day of completing.
      const number = await seed(tx, ctx, { worked: 75, scheduledDate: "2033-11-09" });
      const rows = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      expect(rows).toEqual([
        {
          number,
          completedDay: "2033-11-10",
          customerName: "Exporttest Bakkerij",
          street: "Gasthuisstraat 23",
          postalCode: "2300",
          city: "Turnhout",
          technicianName: "Kevin Wouters",
          workType: "repair",
          instructions: "Herstelling",
          minutes: 75,
          notes: "Filter vervangen",
          status: "completed",
        },
      ]);
      // Data minimisation: nothing about the customer's phone or e-mail address, no ids.
      expect(JSON.stringify(rows)).not.toContain("geheim@klant.example");
      expect(JSON.stringify(rows)).not.toContain("014 00 00 00");
    });
  });

  it("uses the corrected hours when there are any, otherwise the technician's hours", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const plain = await seed(tx, ctx, { worked: 120 });
      const corrected = await seed(tx, ctx, { worked: 120, corrected: 90 });
      const rows = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      const minutes = Object.fromEntries(rows.map((row) => [row.number, row.minutes]));
      expect(minutes).toEqual({ [plain]: 120, [corrected]: 90 });
    });
  });

  it("selects only Afgewerkt by default and also Gefactureerd for scope 'all'; never cancelled or unfinished tasks", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const completed = await seed(tx, ctx, { status: "completed" });
      const invoiced = await seed(tx, ctx, { status: "invoiced" });
      await seed(tx, ctx, { status: "cancelled" });
      await seed(tx, ctx, { status: "picked_up" });
      await seed(tx, ctx, { status: "assigned" });

      const onlyCompleted = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      expect(onlyCompleted.map((row) => row.number)).toEqual([completed]);

      const all = await queryExportRows(tx, { ...PERIOD, scope: "all" });
      expect(all.map((row) => [row.number, row.status])).toEqual([
        [completed, "completed"],
        [invoiced, "invoiced"],
      ]);
    });
  });

  it("selects on the day of completing, in Belgian time, both days inclusive", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      // Winter (UTC+1): 31/10 23:30 in Belgium is 22:30 UTC; 01/11 00:00 is 23:00 UTC on 31/10.
      const justBefore = await seed(tx, ctx, { completedAt: "2033-10-31T22:59:59Z" });
      const firstMoment = await seed(tx, ctx, { completedAt: "2033-10-31T23:00:00Z" });
      const lastDayLate = await seed(tx, ctx, { completedAt: "2033-11-30T22:59:59Z" }); // 30/11 23:59:59
      const nextDay = await seed(tx, ctx, { completedAt: "2033-11-30T23:00:00Z" }); // 01/12 00:00
      const rows = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      const numbers = rows.map((row) => row.number);
      expect(numbers).toContain(firstMoment);
      expect(numbers).toContain(lastDayLate);
      expect(numbers).not.toContain(justBefore);
      expect(numbers).not.toContain(nextDay);
    });
  });

  it("follows the clock change: summer time is UTC+2", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const inJune = await seed(tx, ctx, { completedAt: "2033-05-31T22:00:00Z" }); // 01/06 00:00
      const inMay = await seed(tx, ctx, { completedAt: "2033-05-31T21:59:59Z" }); // 31/05 23:59
      const rows = await queryExportRows(tx, {
        from: "2033-06-01",
        to: "2033-06-30",
        scope: "completed",
      });
      expect(rows.map((row) => row.number)).toEqual([inJune]);
      expect(rows.map((row) => row.number)).not.toContain(inMay);
    });
  });

  it("selects on the completion day, not on the planned day", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const plannedEarlier = await seed(tx, ctx, {
        scheduledDate: "2033-10-30",
        completedAt: "2033-11-02T09:00:00Z",
      });
      const plannedInside = await seed(tx, ctx, {
        scheduledDate: "2033-11-15",
        completedAt: "2033-12-02T09:00:00Z",
      });
      const rows = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      expect(rows.map((row) => row.number)).toEqual([plannedEarlier]);
      expect(rows.map((row) => row.number)).not.toContain(plannedInside);
    });
  });

  it("allows a period of one day and returns nothing for an empty period", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const number = await seed(tx, ctx, { completedAt: "2033-11-10T10:00:00Z" });
      const oneDay = { from: "2033-11-10", to: "2033-11-10", scope: "completed" } as const;
      expect((await queryExportRows(tx, oneDay)).map((row) => row.number)).toEqual([number]);
      const none = { from: "2033-11-11", to: "2033-11-11", scope: "completed" } as const;
      expect(await queryExportRows(tx, none)).toEqual([]);
    });
  });

  it("orders by the day of completing and then the task number", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const late = await seed(tx, ctx, { completedAt: "2033-11-20T10:00:00Z" });
      const early = await seed(tx, ctx, { completedAt: "2033-11-03T15:00:00Z" });
      // The same Belgian day as `early`, an hour earlier: the day counts, not the hour.
      const sameDay = await seed(tx, ctx, { completedAt: "2033-11-03T14:00:00Z" });
      const rows = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      expect(rows.map((row) => row.number)).toEqual([early, sameDay, late]);
    });
  });

  it("writes the Belgian day of completing, also just after midnight", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      await seed(tx, ctx, { completedAt: "2033-11-09T23:30:00Z" }); // 10/11 00:30 in Belgium
      const [row] = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      expect(row.completedDay).toBe("2033-11-10");
    });
  });

  it.each([
    // Spring forward on 27/03/2033: that day has 23 hours (23:00Z the day before up to 22:00Z).
    ["2033-03-27", "2033-03-26T22:59:59Z", false],
    ["2033-03-27", "2033-03-26T23:00:00Z", true],
    ["2033-03-27", "2033-03-27T21:59:59Z", true],
    ["2033-03-27", "2033-03-27T22:00:00Z", false],
    // Fall back on 30/10/2033: that day has 25 hours (22:00Z the day before up to 23:00Z).
    ["2033-10-30", "2033-10-29T21:59:59Z", false],
    ["2033-10-30", "2033-10-29T22:00:00Z", true],
    ["2033-10-30", "2033-10-30T22:59:59Z", true],
    ["2033-10-30", "2033-10-30T23:00:00Z", false],
  ])("on the clock change day %s, %s is inside the day: %s", async (day, completedAt, inside) => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const number = await seed(tx, ctx, { completedAt });
      const rows = await queryExportRows(tx, { from: day, to: day, scope: "completed" });
      expect(rows.map((row) => row.number)).toEqual(inside ? [number] : []);
    });
  });

  it("shows in the overview exactly the tasks of the file: a task planned 31/10 and completed 03/11 is in both", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      const late = await seed(tx, ctx, {
        scheduledDate: "2033-10-31",
        completedAt: "2033-11-03T09:00:00Z",
      });
      // Planned inside November, completed in December: in neither.
      const later = await seed(tx, ctx, {
        scheduledDate: "2033-11-15",
        completedAt: "2033-12-02T09:00:00Z",
      });
      const earlyStart = await seed(tx, ctx, {
        scheduledDate: "2033-11-30",
        completedAt: "2033-11-30T22:59:59Z",
      });
      const file = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      const filters = parseTaskOverviewParams({
        status: "completed",
        from: PERIOD.from,
        to: PERIOD.to,
      });
      const overview = await queryTaskOverview(tx, filters);
      const inFile = file.map((row) => row.number).sort();
      const inList = overview.rows.map((row) => row.number).sort();
      expect(inFile).toEqual([late, earlyStart].sort());
      expect(inList).toEqual(inFile);
      expect(inList).not.toContain(later);
      // The number on the tab is what the tab shows.
      expect(overview.counts.completed).toBe(inList.length);
    });
  });

  it("counts per tab with a period: Afgewerkt and Gefactureerd by day of completing, the others by planned day", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      // Assigned: planned in November, so it counts; its completion day does not exist.
      await seed(tx, ctx, { status: "assigned", scheduledDate: "2033-11-12" });
      await seed(tx, ctx, { status: "assigned", scheduledDate: "2033-12-12" });
      // Completed: planned in October, completed in November: counts. The reverse does not.
      await seed(tx, ctx, {
        scheduledDate: "2033-10-31",
        completedAt: "2033-11-03T09:00:00Z",
      });
      await seed(tx, ctx, {
        scheduledDate: "2033-11-15",
        completedAt: "2033-12-02T09:00:00Z",
      });
      await seed(tx, ctx, {
        status: "invoiced",
        scheduledDate: "2033-10-20",
        completedAt: "2033-11-04T09:00:00Z",
      });
      await seed(tx, ctx, { status: "cancelled", scheduledDate: "2033-11-20" });
      const base = { status: "all", from: PERIOD.from, to: PERIOD.to };
      const { counts } = await queryTaskOverview(tx, parseTaskOverviewParams(base));
      expect(counts.assigned).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.invoiced).toBe(1);
      expect(counts.cancelled).toBe(1);
      // Actief adds up its own statuses, Alle everything: both agree with the tabs.
      expect(counts.active).toBe(counts.assigned + counts.completed);
      expect(counts.all).toBe(4);
      const all = await queryTaskOverview(tx, parseTaskOverviewParams(base));
      expect(all.rows).toHaveLength(counts.all);
      const invoicedTab = await queryTaskOverview(
        tx,
        parseTaskOverviewParams({ ...base, status: "invoiced" }),
      );
      expect(invoicedTab.rows).toHaveLength(1);
      // One bound only: from the 3rd of November on, completed tasks are those of the 3rd or later.
      const onlyFrom = await queryTaskOverview(
        tx,
        parseTaskOverviewParams({ status: "completed", from: "2033-12-01" }),
      );
      expect(onlyFrom.rows).toHaveLength(1);
    });
  });

  it("returns notes as null when there are none", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ctx = await setUp(tx);
      await seed(tx, ctx, { notes: null });
      const [row] = await queryExportRows(tx, { ...PERIOD, scope: "completed" });
      expect(row.notes).toBeNull();
    });
  });
});
