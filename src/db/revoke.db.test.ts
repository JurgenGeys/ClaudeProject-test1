import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { revokeInvitationProfile } from "@/lib/technicians/revoke";

// "Uitnodiging intrekken" (BT-07c) against the real database (local Supabase in CI): the rule
// about who may be revoked, the foreign keys that must keep the profile when something refers to
// it, and the row lock.
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

async function createProfile(
  tx: Pick<Db, "execute">,
  name: string,
  fields: { role?: string; isActive?: boolean; invitePending?: boolean } = {},
): Promise<string> {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@revoke-test.example`;
  const [user] = await tx.execute<{ id: string }>(
    sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`,
  );
  const isActive = fields.isActive ?? true;
  await tx.execute(sql`
    insert into public.profiles (id, full_name, email, role, is_active, deactivated_at, invite_pending)
    values (${user.id}, ${name}, ${email}, ${fields.role ?? "technician"}, ${isActive},
            ${isActive ? null : new Date().toISOString()}, ${fields.invitePending ?? true})
  `);
  return user.id;
}

async function profileExists(tx: Pick<Db, "execute">, id: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from public.profiles where id = ${id}`);
  return rows.length > 0;
}

async function createCustomer(tx: Pick<Db, "execute">, createdBy: string): Promise<string> {
  const [customer] = await tx.execute<{ id: string }>(
    sql`insert into public.customers (name, created_by) values ('Klant', ${createdBy}) returning id`,
  );
  return customer.id;
}

async function createTask(
  tx: Pick<Db, "execute">,
  customerId: string,
  office: string,
  assignee: string | null,
): Promise<void> {
  await tx.execute(sql`
    insert into public.tasks (
      customer_id, location_street, location_postal_code, location_city, work_type, instructions,
      scheduled_date, start_time, status, assignee_id, created_by, updated_by
    ) values (${customerId}, 'Straat 1', '9000', 'Gent', 'inspection', 'Nazicht',
              '2026-12-01', '09:00', ${assignee ? "assigned" : "open"}, ${assignee}, ${office}, ${office})
  `);
}

describe("revokeInvitationProfile", () => {
  it("deletes the profile of an invited technician and nothing else", async () => {
    await inRolledBackTransaction(async (tx) => {
      const yana = await createProfile(tx, "Yana Willems");
      const kevin = await createProfile(tx, "Kevin Wouters", { invitePending: false });

      expect(await revokeInvitationProfile(tx, yana)).toEqual({
        kind: "revoked",
        fullName: "Yana Willems",
      });
      expect(await profileExists(tx, yana)).toBe(false);
      expect(await profileExists(tx, kevin)).toBe(true);
      // Auth is not touched here: the Server Action blocks and deletes the account.
      const users = await tx.execute(sql`select 1 from auth.users where id = ${yana}`);
      expect(users).toHaveLength(1);
    });
  });

  it("also removes the temporary sessions of a password link, which would block the delete", async () => {
    await inRolledBackTransaction(async (tx) => {
      const yana = await createProfile(tx, "Yana Willems");
      await tx.execute(
        sql`insert into public.recovery_sessions (session_id, user_id) values (gen_random_uuid(), ${yana})`,
      );
      expect(await revokeInvitationProfile(tx, yana)).toMatchObject({ kind: "revoked" });
      expect(await profileExists(tx, yana)).toBe(false);
      const left = await tx.execute(
        sql`select 1 from public.recovery_sessions where user_id = ${yana}`,
      );
      expect(left).toHaveLength(0);
    });
  });

  it("refuses an unknown id and a backoffice user, even one that is marked as pending", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", { role: "backoffice" });
      expect(await revokeInvitationProfile(tx, "00000000-0000-4000-8000-000000000000")).toEqual({
        kind: "not-found",
      });
      expect(await revokeInvitationProfile(tx, office)).toEqual({ kind: "not-found" });
      expect(await profileExists(tx, office)).toBe(true);
    });
  });

  it("refuses a technician who has chosen a password (active or switched off)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const kevin = await createProfile(tx, "Kevin Wouters", { invitePending: false });
      const tom = await createProfile(tx, "Tom Hendrickx", {
        invitePending: false,
        isActive: false,
      });
      expect(await revokeInvitationProfile(tx, kevin)).toEqual({
        kind: "not-pending",
        fullName: "Kevin Wouters",
      });
      expect(await revokeInvitationProfile(tx, tom)).toEqual({
        kind: "not-pending",
        fullName: "Tom Hendrickx",
      });
      expect(await profileExists(tx, kevin)).toBe(true);
      expect(await profileExists(tx, tom)).toBe(true);
    });
  });

  it("refuses when a task is assigned to him (cannot happen through the app, checked anyway)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", {
        role: "backoffice",
        invitePending: false,
      });
      const yana = await createProfile(tx, "Yana Willems");
      await createTask(tx, await createCustomer(tx, office), office, yana);

      expect(await revokeInvitationProfile(tx, yana)).toEqual({
        kind: "has-records",
        fullName: "Yana Willems",
      });
      expect(await profileExists(tx, yana)).toBe(true);
    });
  });

  it("refuses when he created a customer or a task, or completed one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", {
        role: "backoffice",
        invitePending: false,
      });
      const customerMaker = await createProfile(tx, "Klant Maker");
      await createCustomer(tx, customerMaker);
      expect(await revokeInvitationProfile(tx, customerMaker)).toMatchObject({
        kind: "has-records",
      });

      const customerId = await createCustomer(tx, office);
      const taskMaker = await createProfile(tx, "Taak Maker");
      await createTask(tx, customerId, taskMaker, null);
      expect(await revokeInvitationProfile(tx, taskMaker)).toMatchObject({ kind: "has-records" });
      expect(await profileExists(tx, customerMaker)).toBe(true);
      expect(await profileExists(tx, taskMaker)).toBe(true);
    });
  });

  it("the foreign keys alone would also refuse the delete (ON DELETE RESTRICT)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const office = await createProfile(tx, "Sofie Peeters", {
        role: "backoffice",
        invitePending: false,
      });
      const yana = await createProfile(tx, "Yana Willems");
      await createTask(tx, await createCustomer(tx, office), office, yana);
      await expect(
        tx.transaction(async (inner) => {
          await inner.delete(schema.profiles).where(eq(schema.profiles.id, yana));
        }),
      ).rejects.toMatchObject({ cause: { code: "23503" } });
    });
  });

  it("the row lock makes a task that is assigned at the same moment wait, and then see the refusal", async () => {
    const other = connect();
    const suffix = Math.random().toString(36).slice(2, 8);
    const created: { office?: string; yana?: string; customer?: string } = {};
    try {
      // Committed rows, because two connections must see them; removed again in `finally`.
      await db.transaction(async (tx) => {
        created.office = await createProfile(tx, `Sofie Lock ${suffix}`, {
          role: "backoffice",
          invitePending: false,
        });
        created.yana = await createProfile(tx, `Yana Lock ${suffix}`);
        created.customer = await createCustomer(tx, created.office);
      });

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let assignFinishedBeforeRelease = false;
      const revoking = db.transaction(async (tx) => {
        const outcome = await revokeInvitationProfile(tx, created.yana!);
        // Profile deleted, lock held: a concurrent assignment must wait for this transaction.
        const assigning = createTask(other, created.customer!, created.office!, created.yana!).then(
          () => "assigned",
          () => "refused",
        );
        const early = await Promise.race([
          assigning,
          new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 500)),
        ]);
        assignFinishedBeforeRelease = early !== "waiting";
        release();
        await gate;
        return { outcome, assigning };
      });
      const { outcome, assigning } = await revoking;
      expect(outcome.kind).toBe("revoked");
      expect(assignFinishedBeforeRelease).toBe(false);
      // After the commit the profile is gone, so the foreign key refuses the assignment.
      expect(await assigning).toBe("refused");
    } finally {
      await db.execute(
        sql`delete from public.tasks where customer_id = ${created.customer ?? null}`,
      );
      await db.execute(sql`delete from public.customers where id = ${created.customer ?? null}`);
      await db.execute(
        sql`delete from public.profiles where id in (${created.office ?? null}, ${created.yana ?? null})`,
      );
      await db.execute(
        sql`delete from auth.users where id in (${created.office ?? null}, ${created.yana ?? null})`,
      );
    }
  });
});
