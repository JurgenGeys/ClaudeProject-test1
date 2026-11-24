import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { authUsers } from "drizzle-orm/supabase";
import postgres from "postgres";

import { profiles } from "../../src/db/schema/profiles";

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
  await withDb(async (db) => {
    await db
      .update(profiles)
      .set({ isActive, deactivatedAt: isActive ? null : new Date() })
      .where(eq(profiles.email, email));
  });
}
