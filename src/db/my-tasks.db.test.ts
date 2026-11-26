import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTaskDetail } from "@/lib/tasks/detail";
import { queryMyTasks } from "@/lib/tasks/my-tasks";

import type { Database } from "./client";

// "Mijn taken" of the technician (BT-11) against the real database (local Supabase in CI): only
// the own tasks, the sort order, cancelled and not assigned tasks that never show up, the 30 day
// window of the Afgewerkt tab, and the task of T2 that only the assignee can find. Everything
// runs in a transaction that is always rolled back. Every query is bound to a technician made
// in this test, so tasks that other tests or a developer left in the database do not matter.
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

const asDb = (tx: Tx) => tx as unknown as Database;

// Monday 23/11/2026, 10:00 in Belgium. The last 30 days (today included) start on 25/10/2026.
const NOW = new Date("2026-11-23T09:00:00Z");

async function createProfile(tx: Tx, name: string, role = "technician"): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@my-tasks-test.example`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role, is_active, invite_pending)
    values (${user.id}, ${name}, ${email}, ${role}, true, false)
  `);
  return user.id;
}

type TaskSpec = {
  status: string;
  date: string;
  time?: string;
  assignee?: string | null;
  customer?: string;
  /** For completed and invoiced tasks. */
  worked?: number;
  corrected?: number;
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
  const stamp = "2026-11-20T07:48:00Z";
  const pickedUp = ["picked_up", "completed", "invoiced"].includes(status);
  const [task] = await tx.execute<{ id: string; number: number }>(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, estimated_minutes, assignee_id, status, picked_up_at,
      cancelled_at, cancelled_by, invoiced_at, invoiced_by, created_by, updated_by
    ) values (
      ${customerId}, 'Straat 1', '2300', 'Turnhout', 'maintenance', ${"Onderhoud\nTweede regel"},
      ${spec.date}, ${spec.time ?? "09:00"}, 90,
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
      values (${task.id}, ${spec.worked}, ${spec.assignee}, ${spec.completedAt ?? stamp},
        ${spec.corrected ?? null}, ${spec.corrected ? "Klant bevestigde" : null},
        ${spec.corrected ? office : null}, ${spec.corrected ? stamp : null})
    `);
  }
  return task.number;
}

async function seed(tx: Tx) {
  const office = await createProfile(tx, "Sofie Peeters", "backoffice");
  const kevin = await createProfile(tx, "Kevin Wouters");
  const jens = await createProfile(tx, "Jens Maes");
  const [customer] = await tx.execute<{ id: string }>(
    sql`insert into public.customers (name, created_by) values ('Mijn-taken-testklant', ${office}) returning id`,
  );
  const make = (spec: TaskSpec) => createTask(tx, office, customer.id, spec);
  return { office, kevin, jens, make };
}

describe("queryMyTasks, tab Te doen", () => {
  it("returns only the assigned and picked up tasks of this technician", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, kevin, jens, make } = await seed(tx);
      const mine = await make({ status: "assigned", date: "2026-11-24", assignee: kevin });
      const busy = await make({ status: "picked_up", date: "2026-11-23", assignee: kevin });
      // Everything that must not show up:
      await make({ status: "assigned", date: "2026-11-24", assignee: jens });
      await make({ status: "picked_up", date: "2026-11-24", assignee: jens });
      await make({ status: "open", date: "2026-11-24" });
      await make({ status: "completed", date: "2026-11-20", assignee: kevin, worked: 60 });
      await make({ status: "invoiced", date: "2026-11-19", assignee: kevin, worked: 60 });
      await make({ status: "cancelled", date: "2026-11-24", assignee: kevin });
      await make({ status: "cancelled", date: "2026-11-24" });
      expect(office).toBeTruthy();

      const result = await queryMyTasks(asDb(tx), kevin, "todo", NOW);
      expect(result.tab).toBe("todo");
      expect(result.tasks.map((t) => t.number).sort()).toEqual([mine, busy].sort());

      const other = await queryMyTasks(asDb(tx), jens, "todo", NOW);
      expect(other.tasks).toHaveLength(2);
      expect(other.tasks.every((t) => t.number !== mine && t.number !== busy)).toBe(true);
    });
  });

  it("shows no cancelled task, also not the one that was assigned to him", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, make } = await seed(tx);
      const cancelled = await make({ status: "cancelled", date: "2026-11-24", assignee: kevin });
      const result = await queryMyTasks(asDb(tx), kevin, "todo", NOW);
      expect(result.tasks.map((t) => t.number)).not.toContain(cancelled);
      const done = await queryMyTasks(asDb(tx), kevin, "done", NOW);
      expect(done.tasks.map((t) => t.number)).not.toContain(cancelled);
    });
  });

  it("sorts on day, then start time, then number", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, make } = await seed(tx);
      const late = await make({
        status: "assigned",
        date: "2026-11-24",
        time: "14:00",
        assignee: kevin,
      });
      const early = await make({
        status: "assigned",
        date: "2026-11-24",
        time: "09:00",
        assignee: kevin,
      });
      const sameFirst = await make({
        status: "assigned",
        date: "2026-11-25",
        time: "08:00",
        assignee: kevin,
      });
      const sameSecond = await make({
        status: "assigned",
        date: "2026-11-25",
        time: "08:00",
        assignee: kevin,
      });
      const past = await make({
        status: "assigned",
        date: "2026-11-20",
        time: "15:00",
        assignee: kevin,
      });
      const result = await queryMyTasks(asDb(tx), kevin, "todo", NOW);
      expect(result.tasks.map((t) => t.number)).toEqual([past, early, late, sameFirst, sameSecond]);
    });
  });

  it("returns what the cards show", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, make } = await seed(tx);
      const number = await make({
        status: "picked_up",
        date: "2026-11-23",
        time: "08:00",
        assignee: kevin,
      });
      const result = await queryMyTasks(asDb(tx), kevin, "todo", NOW);
      expect(result.tab).toBe("todo");
      expect(result.tasks).toEqual([
        expect.objectContaining({
          number,
          scheduledDate: "2026-11-23",
          startTime: "08:00:00",
          estimatedMinutes: 90,
          customerName: "Mijn-taken-testklant",
          city: "Turnhout",
          workType: "maintenance",
          instructions: "Onderhoud\nTweede regel",
          status: "picked_up",
          pickedUpAt: new Date("2026-11-20T07:48:00Z"),
        }),
      ]);
    });
  });

  it("returns nothing for a technician without tasks, and nothing for the back office", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { office, make, jens } = await seed(tx);
      await make({ status: "assigned", date: "2026-11-24", assignee: jens });
      const nobody = await createProfile(tx, "Bram Claes");
      expect((await queryMyTasks(asDb(tx), nobody, "todo", NOW)).tasks).toEqual([]);
      expect((await queryMyTasks(asDb(tx), office, "todo", NOW)).tasks).toEqual([]);
    });
  });
});

describe("queryMyTasks, tab Afgewerkt", () => {
  it("returns his Afgewerkt and Gefactureerd tasks, newest finished first, with the hours he filled in", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, jens, make } = await seed(tx);
      const older = await make({
        status: "completed",
        date: "2026-11-10",
        assignee: kevin,
        worked: 120,
        corrected: 90,
        completedAt: "2026-11-10T10:00:00Z",
      });
      const newer = await make({
        status: "invoiced",
        date: "2026-11-05", // planned long ago, but finished last
        assignee: kevin,
        worked: 60,
        completedAt: "2026-11-20T10:00:00Z",
      });
      await make({ status: "completed", date: "2026-11-19", assignee: jens, worked: 60 });
      await make({ status: "assigned", date: "2026-11-19", assignee: kevin });
      await make({ status: "picked_up", date: "2026-11-19", assignee: kevin });

      const result = await queryMyTasks(asDb(tx), kevin, "done", NOW);
      if (result.tab !== "done") {
        throw new Error("expected the Afgewerkt tab");
      }
      expect(result.tasks.map((t) => t.number)).toEqual([newer, older]);
      // The hours he filled in (2u00), not the correction of the back office (1u30).
      expect(result.tasks.map((t) => t.workedMinutes)).toEqual([60, 120]);
      expect(result.tasks[0]).toEqual(
        expect.objectContaining({
          scheduledDate: "2026-11-05",
          customerName: "Mijn-taken-testklant",
          city: "Turnhout",
          workType: "maintenance",
          completedAt: new Date("2026-11-20T10:00:00Z"),
        }),
      );
    });
  });

  it("looks back 30 Belgian days from today, counted on the day he finished", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, make } = await seed(tx);
      const done = (completedAt: string) =>
        make({ status: "completed", date: "2026-10-01", assignee: kevin, worked: 60, completedAt });
      // Today is 23/11, so the first day is 25/10 (30 days with today). Summer time ends at
      // 03:00 that day, so 00:00 on 25/10 is still UTC+2.
      const lastMinuteBefore = await done("2026-10-24T21:59:00Z"); // 23:59 on 24/10 in Belgium
      const firstMinute = await done("2026-10-24T22:00:00Z"); // 00:00 on 25/10 in Belgium
      const today = await done("2026-11-23T08:30:00Z");

      const numbers = (await queryMyTasks(asDb(tx), kevin, "done", NOW)).tasks.map((t) => t.number);
      expect(numbers).toContain(firstMinute);
      expect(numbers).toContain(today);
      expect(numbers).not.toContain(lastMinuteBefore);
    });
  });
});

describe("queryTaskDetail for a technician (T2)", () => {
  it("finds his own task, in every status that he can see", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, make } = await seed(tx);
      const statuses = ["assigned", "picked_up", "completed", "invoiced"] as const;
      for (const status of statuses) {
        const worked = status === "completed" || status === "invoiced" ? 90 : undefined;
        const number = await make({ status, date: "2026-11-23", assignee: kevin, worked });
        const task = await queryTaskDetail(asDb(tx), number, { assigneeId: kevin });
        expect(task).toEqual(expect.objectContaining({ number, status }));
        expect(task?.completion?.workedMinutes).toBe(worked);
      }
    });
  });

  it("finds his own cancelled task, so the page can tell him it is cancelled", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, make } = await seed(tx);
      const number = await make({ status: "cancelled", date: "2026-11-24", assignee: kevin });
      const task = await queryTaskDetail(asDb(tx), number, { assigneeId: kevin });
      expect(task?.status).toBe("cancelled");
    });
  });

  it("finds nothing for the task of a colleague, a task that is not assigned or a number that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { kevin, jens, make } = await seed(tx);
      const theirs = await make({ status: "assigned", date: "2026-11-24", assignee: jens });
      const theirsPickedUp = await make({
        status: "picked_up",
        date: "2026-11-24",
        assignee: jens,
      });
      const unassigned = await make({ status: "open", date: "2026-11-24" });
      for (const number of [theirs, theirsPickedUp, unassigned, 999_999_999]) {
        expect(await queryTaskDetail(asDb(tx), number, { assigneeId: kevin })).toBeNull();
      }
      // The same numbers do exist for the back office, which has no assignee filter.
      expect(await queryTaskDetail(asDb(tx), theirs)).not.toBeNull();
      // And for the rightful assignee.
      expect(await queryTaskDetail(asDb(tx), theirs, { assigneeId: jens })).not.toBeNull();
    });
  });

  it("does not turn an empty id into 'no filter'", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { jens, make } = await seed(tx);
      const theirs = await make({ status: "assigned", date: "2026-11-24", assignee: jens });
      // An empty string is not a uuid: the database refuses it, it never returns the task.
      await expect(queryTaskDetail(asDb(tx), theirs, { assigneeId: "" })).rejects.toThrow();
    });
  });
});
