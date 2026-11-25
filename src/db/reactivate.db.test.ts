import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { deactivateTechnicianProfile } from "@/lib/technicians/deactivate";
import { reactivateTechnicianProfile } from "@/lib/technicians/reactivate";

// "Technieker opnieuw activeren" (BT-07b) against the real database (local Supabase in CI): the
// profile change with its check constraint, the refusals, and that tasks are not given back.
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

async function createProfile(
  tx: Pick<Db, "execute">,
  name: string,
  fields: { role?: string; isActive?: boolean; invitePending?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@reactivate-test.example`;
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

async function readProfile(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx
    .select({
      isActive: schema.profiles.isActive,
      deactivatedAt: schema.profiles.deactivatedAt,
    })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, id));
  return row;
}

describe("reactivateTechnicianProfile", () => {
  it("sets is_active = true and clears deactivated_at, as the check constraint demands", async () => {
    await inRolledBackTransaction(async (tx) => {
      const tom = await createProfile(tx, "Tom Hendrickx", { isActive: false });
      const before = await readProfile(tx, tom);
      expect(before.isActive).toBe(false);
      expect(before.deactivatedAt).toBeInstanceOf(Date);

      expect(await reactivateTechnicianProfile(tx, tom)).toEqual({
        kind: "reactivated",
        fullName: "Tom Hendrickx",
      });

      expect(await readProfile(tx, tom)).toEqual({ isActive: true, deactivatedAt: null });
    });
  });

  it("is the reverse of switching off: off and on again gives the original state", async () => {
    await inRolledBackTransaction(async (tx) => {
      const bram = await createProfile(tx, "Bram Claes");
      expect(await deactivateTechnicianProfile(tx, bram)).toMatchObject({ kind: "deactivated" });
      expect((await readProfile(tx, bram)).isActive).toBe(false);

      expect(await reactivateTechnicianProfile(tx, bram)).toMatchObject({ kind: "reactivated" });
      expect(await readProfile(tx, bram)).toEqual({ isActive: true, deactivatedAt: null });
      // And again is possible.
      expect(await deactivateTechnicianProfile(tx, bram)).toMatchObject({ kind: "deactivated" });
    });
  });

  it("does not give tasks back: the finished and the cancelled work stays with its technician and nothing else changes", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      const tom = await createProfile(tx, "Tom Hendrickx", { isActive: false });
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into public.customers (name, created_by) values ('Klant', ${office}) returning id`,
      );
      // A task that was moved to someone else while he was switched off stays there.
      const [task] = await tx.execute<{ id: string }>(sql`
        insert into public.tasks (
          customer_id, location_street, location_postal_code, location_city, work_type, instructions,
          scheduled_date, start_time, status, created_by, updated_by
        ) values (${customer.id}, 'Straat 1', '9000', 'Gent', 'inspection', 'Nazicht',
                  '2026-12-01', '09:00', 'open', ${office}, ${office})
        returning id
      `);

      expect(await reactivateTechnicianProfile(tx, tom)).toMatchObject({ kind: "reactivated" });

      const [after] = await tx.execute<{ assignee_id: string | null; status: string }>(
        sql`select assignee_id, status from public.tasks where id = ${task.id}`,
      );
      expect(after).toEqual({ assignee_id: null, status: "open" });
    });
  });

  it("refuses an unknown id and a backoffice user, even a switched-off one, and changes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", {
        role: "backoffice",
        isActive: false,
      });

      expect(await reactivateTechnicianProfile(tx, "00000000-0000-4000-8000-000000000000")).toEqual(
        {
          kind: "not-found",
        },
      );
      expect(await reactivateTechnicianProfile(tx, office)).toEqual({ kind: "not-found" });
      expect(await readProfile(tx, office)).toMatchObject({ isActive: false });
    });
  });

  it("refuses an active technician and an invited one, and changes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const kevin = await createProfile(tx, "Kevin Wouters");
      const yana = await createProfile(tx, "Yana Willems", { invitePending: true });

      expect(await reactivateTechnicianProfile(tx, kevin)).toEqual({
        kind: "already-active",
        fullName: "Kevin Wouters",
      });
      expect(await reactivateTechnicianProfile(tx, yana)).toEqual({
        kind: "invited",
        fullName: "Yana Willems",
      });
      expect(await readProfile(tx, kevin)).toEqual({ isActive: true, deactivatedAt: null });
      expect(await readProfile(tx, yana)).toEqual({ isActive: true, deactivatedAt: null });
    });
  });

  it("the check constraint still refuses a half switch-on (active with a deactivation moment)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const tom = await createProfile(tx, "Tom Hendrickx", { isActive: false });
      await expect(
        tx.transaction(async (inner) => {
          await inner.execute(sql`update public.profiles set is_active = true where id = ${tom}`);
        }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    });
  });
});
