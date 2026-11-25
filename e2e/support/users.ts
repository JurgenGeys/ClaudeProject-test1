import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { authUsers } from "drizzle-orm/supabase";
import postgres from "postgres";

import { assertLocalSupabase } from "../../src/lib/supabase/local-only";
import { customers } from "../../src/db/schema/customers";
import { profiles } from "../../src/db/schema/profiles";
import { tasks } from "../../src/db/schema/tasks";

import { TEST_PASSWORD, type TestUser } from "./test-users";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The end-to-end tests need a running (local) Supabase: start it with ` +
        "`supabase start`, run `pnpm db:migrate` and put the values of `supabase status -o env` " +
        "in .env.local (see the README).",
    );
  }
  return value;
}

/** Runs `work` with a short-lived database connection (Drizzle, as everywhere in the project). */
async function withDb<T>(work: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const client = postgres(requireEnv("DATABASE_URL"), { max: 1, prepare: false });
  try {
    return await work(drizzle(client));
  } finally {
    await client.end();
  }
}

/**
 * Makes sure the user exists in Supabase Auth with the test password and the wanted state,
 * and that the profile matches. Safe to run again: it resets an existing user to that state.
 */
export async function ensureUser(user: TestUser): Promise<void> {
  assertLocalSupabase(process.env);
  const admin = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const isActive = user.isActive ?? true;

  await withDb(async (db) => {
    const existing = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(sql`lower(${authUsers.email}) = ${user.email.toLowerCase()}`)
      .limit(1);

    let id = existing[0]?.id;
    if (!id) {
      const created = await admin.auth.admin.createUser({
        email: user.email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(`Creating test user ${user.email} failed: ${created.error?.message}`);
      }
      id = created.data.user.id;
    }

    const updated = await admin.auth.admin.updateUserById(id, {
      password: TEST_PASSWORD,
      ban_duration: user.banned ? "87600h" : "none",
    });
    if (updated.error) {
      throw new Error(`Updating test user ${user.email} failed: ${updated.error.message}`);
    }

    const values = {
      id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive,
      deactivatedAt: isActive ? null : new Date(),
    };
    await db
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({ target: profiles.id, set: values });
  });
}

/** Activates or deactivates the profile of a user, like the "uitschakelen" feature will do. */
export async function setProfileActive(email: string, isActive: boolean): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    await db
      .update(profiles)
      .set({ isActive, deactivatedAt: isActive ? null : new Date() })
      .where(eq(profiles.email, email));
  });
}

/**
 * Removes a user again: the profile (Drizzle) and the Auth account (admin API). For the users
 * that a test creates itself, such as an invited technician, so they do not show up in the
 * technician list of later tests.
 */
export async function removeUser(email: string): Promise<void> {
  assertLocalSupabase(process.env);
  const admin = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const id = await withDb(async (db) => {
    const found = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(sql`lower(${authUsers.email}) = ${email.toLowerCase()}`)
      .limit(1);
    if (found[0]) {
      await db.delete(profiles).where(eq(profiles.id, found[0].id));
    }
    return found[0]?.id;
  });
  if (id) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      throw new Error(`Removing test user ${email} failed: ${error.message}`);
    }
  }
}

/** Moves the moment the invitation link was verified, to test the 24 hour limit. */
export async function setInviteVerifiedAt(email: string, verifiedAt: Date): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    await db
      .update(profiles)
      .set({ inviteVerifiedAt: verifiedAt })
      .where(eq(profiles.email, email.toLowerCase()));
  });
}

/** Moves the moment the "wachtwoord vergeten" link was confirmed, to test the 24 hour limit. */
export async function setRecoveryVerifiedAt(email: string, verifiedAt: Date): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    await db
      .update(profiles)
      .set({ recoveryVerifiedAt: verifiedAt })
      .where(eq(profiles.email, email.toLowerCase()));
  });
}

/**
 * Gives a technician `count` open tasks (status Toegewezen), through Drizzle, with a customer of
 * its own. `createdByEmail` is the backoffice user the tasks are "created by". Returns nothing;
 * `removeTasksOf` cleans up (profiles cannot be removed while tasks refer to them).
 */
export async function createAssignedTasks(
  technicianEmail: string,
  createdByEmail: string,
  count: number,
): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [technician] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, technicianEmail.toLowerCase()));
    const [office] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, createdByEmail.toLowerCase()));
    if (!technician || !office) {
      throw new Error("createAssignedTasks: technician or backoffice user not found");
    }
    const [customer] = await db
      .insert(customers)
      .values({ name: `E2E klant van ${technicianEmail}`, createdBy: office.id })
      .returning({ id: customers.id });
    for (let index = 0; index < count; index++) {
      await db.insert(tasks).values({
        customerId: customer.id,
        locationStreet: "Teststraat 1",
        locationPostalCode: "9000",
        locationCity: "Gent",
        workType: "inspection",
        instructions: "E2E-taak",
        scheduledDate: "2026-12-01",
        startTime: "09:00",
        assigneeId: technician.id,
        status: "assigned",
        createdBy: office.id,
        updatedBy: office.id,
      });
    }
  });
}

/** Removes the tasks of a technician and the customers that `createAssignedTasks` made for them. */
export async function removeTasksOf(technicianEmail: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [technician] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, technicianEmail.toLowerCase()));
    if (technician) {
      await db.delete(tasks).where(eq(tasks.assigneeId, technician.id));
    }
    await db.delete(customers).where(eq(customers.name, `E2E klant van ${technicianEmail}`));
  });
}

/** Whether the Auth account is blocked (`auth.users.banned_until` lies in the future). */
export async function isAuthBlocked(email: string): Promise<boolean> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const rows = await db.execute<{ blocked: boolean }>(sql`
      select coalesce(banned_until > now(), false) as blocked
      from auth.users where lower(email) = ${email.toLowerCase()}
    `);
    return rows[0]?.blocked ?? false;
  });
}

/** The profile fields that switching off sets. */
export async function readProfileState(
  email: string,
): Promise<{ isActive: boolean; deactivatedAt: Date | null } | undefined> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const [row] = await db
      .select({ isActive: profiles.isActive, deactivatedAt: profiles.deactivatedAt })
      .from(profiles)
      .where(eq(profiles.email, email.toLowerCase()));
    return row;
  });
}
