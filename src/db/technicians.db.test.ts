import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { queryTechnicians } from "@/lib/technicians/queries";

import type { Database } from "./client";

// The technician list of B7 against the real database (local Supabase in CI): who is listed,
// which status they get and how open tasks are counted. Everything runs in a transaction that
// is always rolled back.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn() }));

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

async function createProfile(
  tx: Tx,
  name: string,
  fields: { role?: string; isActive?: boolean; invitePending?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@technicians-test.example`;
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

async function createTask(
  tx: Tx,
  customerId: string,
  createdBy: string,
  assigneeId: string | null,
  status: string,
) {
  const now = new Date().toISOString();
  const pickedUp = ["picked_up", "completed", "invoiced"].includes(status);
  const cancelled = status === "cancelled";
  const invoiced = status === "invoiced";
  await tx.execute(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, assignee_id, status, picked_up_at, cancelled_at, cancelled_by,
      created_by, updated_by, invoiced_at, invoiced_by
    ) values (
      ${customerId}, 'Straat 1', '9000', 'Gent', 'inspection', 'Nazicht',
      '2026-12-01', '09:00', ${assigneeId}, ${status},
      ${pickedUp ? now : null}, ${cancelled ? now : null}, ${cancelled ? createdBy : null},
      ${createdBy}, ${createdBy}, ${invoiced ? now : null}, ${invoiced ? createdBy : null}
    )
  `);
}

describe("queryTechnicians", () => {
  it("lists only technicians, with the status that follows from their profile", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      await createProfile(tx, "Kevin Wouters");
      await createProfile(tx, "Yana Willems", { invitePending: true });
      await createProfile(tx, "Tom Hendrickx", { isActive: false });

      // The transaction runs the query, so it sees the rows that are not committed.
      const rows = await queryTechnicians(tx as unknown as Database);
      const mine = rows.filter((row) => row.email.endsWith("@technicians-test.example"));

      expect(mine.map((row) => [row.fullName, row.status])).toEqual([
        ["Kevin Wouters", "active"],
        ["Yana Willems", "invited"],
        ["Tom Hendrickx", "disabled"],
      ]);
      expect(rows.some((row) => row.fullName === "Sofie Peeters")).toBe(false);
    });
  });

  it("counts Toegewezen and Opgepikt tasks as open, and nothing else", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const kevin = await createProfile(tx, "Kevin Wouters");
      await createProfile(tx, "Jens Maes");
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into public.customers (name, created_by) values ('Klant', ${office}) returning id`,
      );

      await createTask(tx, customer.id, office, kevin, "assigned");
      await createTask(tx, customer.id, office, kevin, "assigned");
      await createTask(tx, customer.id, office, kevin, "picked_up");
      await createTask(tx, customer.id, office, kevin, "cancelled");
      await createTask(tx, customer.id, office, kevin, "invoiced");
      await createTask(tx, customer.id, office, null, "open");

      const rows = await queryTechnicians(tx as unknown as Database);
      const open = Object.fromEntries(rows.map((row) => [row.fullName, row.openTasks]));

      expect(open["Kevin Wouters"]).toBe(3);
      // A technician without tasks is listed with 0, not dropped by the join.
      expect(open["Jens Maes"]).toBe(0);
    });
  });
});
