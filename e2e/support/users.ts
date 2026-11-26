import { createClient } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { authUsers } from "drizzle-orm/supabase";
import postgres from "postgres";

import { assertLocalSupabase } from "../../src/lib/supabase/local-only";
import { customers } from "../../src/db/schema/customers";
import { profiles } from "../../src/db/schema/profiles";
import { recoverySessions } from "../../src/db/schema/recovery-sessions";
import { taskCompletions, tasks } from "../../src/db/schema/tasks";

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
      await db.delete(recoverySessions).where(eq(recoverySessions.userId, found[0].id));
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

/**
 * Moves the moment the "wachtwoord vergeten" link was confirmed, for every recovery session of
 * this user, to test the 24 hour limit.
 */
export async function setRecoveryVerifiedAt(email: string, verifiedAt: Date): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email.toLowerCase()))
      .limit(1);
    if (profile) {
      await db
        .update(recoverySessions)
        .set({ verifiedAt })
        .where(eq(recoverySessions.userId, profile.id));
    }
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
      // The completions first: they refer to the tasks (and to the technician).
      await db
        .delete(taskCompletions)
        .where(
          inArray(
            taskCompletions.taskId,
            db.select({ id: tasks.id }).from(tasks).where(eq(tasks.assigneeId, technician.id)),
          ),
        );
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

/** A customer for a test that looks one up in the task form. Returns the id. */
export async function createCustomer(
  name: string,
  createdByEmail: string,
  address: { street: string; postalCode: string; city: string; phone?: string },
): Promise<string> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const [office] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, createdByEmail.toLowerCase()));
    if (!office) {
      throw new Error("createCustomer: backoffice user not found");
    }
    const [customer] = await db
      .insert(customers)
      .values({ name, ...address, createdBy: office.id })
      .returning({ id: customers.id });
    return customer.id;
  });
}

/**
 * Removes the customers whose name starts with `prefix` and their tasks, whoever made them (the
 * task form of a test makes tasks and customers of its own). Tasks first: a customer cannot be
 * removed while tasks refer to it.
 */
export async function removeCustomersNamed(prefix: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const found = await db
      .select({ id: customers.id })
      .from(customers)
      .where(sql`${customers.name} like ${prefix + "%"}`);
    for (const { id } of found) {
      await db
        .delete(taskCompletions)
        .where(
          inArray(
            taskCompletions.taskId,
            db.select({ id: tasks.id }).from(tasks).where(eq(tasks.customerId, id)),
          ),
        );
      await db.delete(tasks).where(eq(tasks.customerId, id));
      await db.delete(customers).where(eq(customers.id, id));
    }
  });
}

/** A saved task with the customer, technician and creator as e-mail addresses, to check what the form saved. */
export async function readTaskByNumber(number: number) {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const assignee = alias(profiles, "assignee");
    const creator = alias(profiles, "creator");
    const [row] = await db
      .select({
        number: tasks.number,
        status: tasks.status,
        workType: tasks.workType,
        instructions: tasks.instructions,
        scheduledDate: tasks.scheduledDate,
        startTime: tasks.startTime,
        estimatedMinutes: tasks.estimatedMinutes,
        locationStreet: tasks.locationStreet,
        locationPostalCode: tasks.locationPostalCode,
        locationCity: tasks.locationCity,
        assigneeEmail: assignee.email,
        createdByEmail: creator.email,
        updatedBy: tasks.updatedBy,
        createdBy: tasks.createdBy,
        customerName: customers.name,
        customerStreet: customers.street,
        customerPostalCode: customers.postalCode,
        customerCity: customers.city,
        customerPhone: customers.phone,
        customerEmail: customers.email,
        customerNotes: customers.notes,
      })
      .from(tasks)
      .innerJoin(customers, eq(customers.id, tasks.customerId))
      .innerJoin(creator, eq(creator.id, tasks.createdBy))
      .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
      .where(eq(tasks.number, number));
    return row;
  });
}

/** How many tasks belong to customers whose name starts with `prefix`. */
export async function countTasksOfCustomersNamed(prefix: string): Promise<number> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const [row] = await db
      .select({ total: sql<number>`count(${tasks.id})::int` })
      .from(tasks)
      .innerJoin(customers, eq(customers.id, tasks.customerId))
      .where(sql`${customers.name} like ${prefix + "%"}`);
    return row.total;
  });
}

/** The id of the profile with this address (as `?technician=<id>` in the overview uses it). */
export async function readProfileId(email: string): Promise<string> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email.toLowerCase()));
    if (!row) {
      throw new Error(`readProfileId: no profile for ${email}`);
    }
    return row.id;
  });
}

export type SeededTask = {
  status: "assigned" | "picked_up" | "completed" | "invoiced" | "cancelled";
  scheduledDate: string;
  startTime?: string;
  /** Needed for Opgepikt and later (the database requires it). Defaults to 06:48 UTC, 07:48 in Belgium in winter. */
  pickedUpAt?: Date;
  /** Worked minutes of a completed or invoiced task. */
  workedMinutes?: number;
  /** A correction by the back office, in minutes. */
  correctedMinutes?: number;
  workType?: "inspection" | "maintenance" | "repair";
  instructions?: string;
  city?: string;
  /** Reason of a cancelled task. */
  cancellationReason?: string;
  /** Notes of the technician on a completed or invoiced task. */
  notes?: string;
};

/**
 * Makes tasks of every status for a technician and a customer, through Drizzle, in the state the
 * database requires for that status (check constraints). Returns the task numbers in the order
 * given. Remove them with `removeCustomersNamed` (the customer's name must start with the prefix
 * that test removes) or `removeTasksOf`.
 */
export async function createTasksWithStatus(
  technicianEmail: string,
  createdByEmail: string,
  customerId: string,
  specs: SeededTask[],
): Promise<number[]> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const [technician] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, technicianEmail.toLowerCase()));
    const [office] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, createdByEmail.toLowerCase()));
    if (!technician || !office) {
      throw new Error("createTasksWithStatus: technician or backoffice user not found");
    }
    const numbers: number[] = [];
    for (const spec of specs) {
      const now = new Date();
      const [task] = await db
        .insert(tasks)
        .values({
          customerId,
          locationStreet: "Teststraat 1",
          locationPostalCode: "9000",
          locationCity: spec.city ?? "Gent",
          workType: spec.workType ?? "inspection",
          instructions: spec.instructions ?? "E2E-taak",
          scheduledDate: spec.scheduledDate,
          startTime: spec.startTime ?? "09:00",
          assigneeId: technician.id,
          status: spec.status,
          pickedUpAt:
            spec.status === "assigned" || spec.status === "cancelled"
              ? null
              : (spec.pickedUpAt ?? new Date("2026-11-23T06:48:00Z")),
          invoicedAt: spec.status === "invoiced" ? now : null,
          invoicedBy: spec.status === "invoiced" ? office.id : null,
          cancelledAt: spec.status === "cancelled" ? now : null,
          cancelledBy: spec.status === "cancelled" ? office.id : null,
          cancellationReason:
            spec.status === "cancelled" ? (spec.cancellationReason ?? null) : null,
          createdBy: office.id,
          updatedBy: office.id,
        })
        .returning({ id: tasks.id, number: tasks.number });
      if (spec.status === "completed" || spec.status === "invoiced") {
        const corrected = spec.correctedMinutes !== undefined;
        await db.insert(taskCompletions).values({
          taskId: task.id,
          workedMinutes: spec.workedMinutes ?? 60,
          notes: spec.notes ?? null,
          completedBy: technician.id,
          ...(corrected
            ? {
                correctedMinutes: spec.correctedMinutes,
                correctionReason: "E2E-correctie",
                correctedBy: office.id,
                correctedAt: now,
              }
            : {}),
        });
      }
      numbers.push(task.number);
    }
    return numbers;
  });
}

/**
 * Changes a task behind the back of an open form, like a colleague would: another instruction
 * text, through Drizzle, so `updated_at` moves like it does for every writer.
 */
export async function changeTaskInstructions(number: number, instructions: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    await db.update(tasks).set({ instructions }).where(eq(tasks.number, number));
  });
}

/**
 * Pretends the technician chose a password in the meantime: `invite_pending` goes to false. For
 * the test of a technician list that is out of date when "Uitnodiging intrekken" is pressed.
 */
export async function markInviteAccepted(email: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    await db
      .update(profiles)
      .set({ invitePending: false, inviteVerifiedAt: null })
      .where(eq(profiles.email, email.toLowerCase()));
  });
}

/** Whether `auth.users` still has an account with this address. */
export async function authAccountExists(email: string): Promise<boolean> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const rows = await db.execute(sql`
      select 1 from auth.users where lower(email) = ${email.toLowerCase()}
    `);
    return rows.length > 0;
  });
}

/**
 * Creates what a revoked invitation leaves behind when deleting the Auth account failed: an
 * invited (not yet confirmed) Auth account with the `invited_by_app` marker, blocked, and no
 * profile. Sends one invitation mail, like the real invitation did.
 */
export async function createRevokedLeftover(email: string): Promise<void> {
  assertLocalSupabase(process.env);
  const admin = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  // Same redirect as the application (`getInviteRedirectUrl`): without it the mail has no
  // /auth/confirm link. That helper is server-only, so the address is built here.
  const redirectTo = new URL("/auth/confirm", process.env.SITE_URL || "http://localhost:3000");
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: redirectTo.href });
  if (invited.error || !invited.data.user) {
    throw new Error(`Inviting test user ${email} failed: ${invited.error?.message}`);
  }
  const updated = await admin.auth.admin.updateUserById(invited.data.user.id, {
    app_metadata: { invited_by_app: true },
    ban_duration: "87600h",
  });
  if (updated.error) {
    throw new Error(`Blocking test user ${email} failed: ${updated.error.message}`);
  }
}

/** The customers whose name starts with `prefix`, as saved (with the e-mail address of their creator), by name. */
export async function readCustomersNamed(prefix: string) {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    return db
      .select({
        id: customers.id,
        name: customers.name,
        street: customers.street,
        postalCode: customers.postalCode,
        city: customers.city,
        phone: customers.phone,
        email: customers.email,
        notes: customers.notes,
        createdByEmail: profiles.email,
      })
      .from(customers)
      .innerJoin(profiles, eq(profiles.id, customers.createdBy))
      .where(sql`${customers.name} like ${prefix + "%"}`)
      .orderBy(customers.name);
  });
}

/** What the database holds about the pick-up of a task: status, the time, and who updated it last. */
export async function readTaskPickUp(number: number): Promise<{
  status: string;
  pickedUpAt: Date | null;
  assigneeEmail: string | null;
  updatedByEmail: string;
}> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const assignee = alias(profiles, "assignee");
    const updater = alias(profiles, "updater");
    const [row] = await db
      .select({
        status: tasks.status,
        pickedUpAt: tasks.pickedUpAt,
        assigneeEmail: assignee.email,
        updatedByEmail: updater.email,
      })
      .from(tasks)
      .innerJoin(updater, eq(updater.id, tasks.updatedBy))
      .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
      .where(eq(tasks.number, number));
    if (!row) {
      throw new Error(`readTaskPickUp: no task ${number}`);
    }
    return row;
  });
}

/** The office cancels a task behind the back of an open page (the technician's screen is out of date). */
export async function cancelTaskAsOffice(number: number, officeEmail: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [office] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, officeEmail.toLowerCase()));
    if (!office) {
      throw new Error("cancelTaskAsOffice: backoffice user not found");
    }
    await db
      .update(tasks)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: office.id })
      .where(eq(tasks.number, number));
  });
}

/** The office gives a task to another technician behind the back of an open page. */
export async function reassignTask(number: number, technicianEmail: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [technician] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, technicianEmail.toLowerCase()));
    if (!technician) {
      throw new Error("reassignTask: technician not found");
    }
    await db.update(tasks).set({ assigneeId: technician.id }).where(eq(tasks.number, number));
  });
}

/** What the database holds of the completion of a task (BT-13): the status and every `task_completions` row. */
export async function readTaskCompletion(number: number): Promise<{
  status: string;
  completions: {
    workedMinutes: number;
    notes: string | null;
    completedAt: Date;
    completedByEmail: string;
  }[];
}> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const [task] = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.number, number));
    if (!task) {
      throw new Error(`readTaskCompletion: no task ${number}`);
    }
    const completions = await db
      .select({
        workedMinutes: taskCompletions.workedMinutes,
        notes: taskCompletions.notes,
        completedAt: taskCompletions.completedAt,
        completedByEmail: profiles.email,
      })
      .from(taskCompletions)
      .innerJoin(profiles, eq(profiles.id, taskCompletions.completedBy))
      .where(eq(taskCompletions.taskId, task.id));
    return { status: task.status, completions };
  });
}

/** The office puts a picked up task back to Toegewezen behind the back of an open page (Terugzetten). */
export async function resetTaskAsOffice(number: number): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    await db
      .update(tasks)
      .set({ status: "assigned", pickedUpAt: null })
      .where(eq(tasks.number, number));
  });
}

/**
 * The technician finishes a picked up task behind the back of an open page (BT-14): the status
 * becomes Afgewerkt and the hours are saved, through Drizzle, so `updated_at` moves like it does
 * for every writer.
 */
export async function completeTaskBehindTheBack(number: number, workedMinutes = 90): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [task] = await db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId })
      .from(tasks)
      .where(eq(tasks.number, number));
    if (!task?.assigneeId) {
      throw new Error(`completeTaskBehindTheBack: no assigned task ${number}`);
    }
    await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, task.id));
    await db.insert(taskCompletions).values({
      taskId: task.id,
      workedMinutes,
      completedBy: task.assigneeId,
    });
  });
}

/** What the database holds about the invoicing of a task: status, when, and by whom (as an e-mail address). */
export async function readTaskInvoicing(number: number): Promise<{
  status: string;
  invoicedAt: Date | null;
  invoicedByEmail: string | null;
}> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const invoicer = alias(profiles, "invoicer");
    const [row] = await db
      .select({
        status: tasks.status,
        invoicedAt: tasks.invoicedAt,
        invoicedByEmail: invoicer.email,
      })
      .from(tasks)
      .leftJoin(invoicer, eq(invoicer.id, tasks.invoicedBy))
      .where(eq(tasks.number, number));
    if (!row) {
      throw new Error(`readTaskInvoicing: no task ${number}`);
    }
    return row;
  });
}

/** A colleague marks a task as invoiced behind the back of an open page (the list is out of date). */
export async function invoiceTaskAsOffice(number: number, officeEmail: string): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [office] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, officeEmail.toLowerCase()));
    if (!office) {
      throw new Error("invoiceTaskAsOffice: backoffice user not found");
    }
    await db
      .update(tasks)
      .set({
        status: "invoiced",
        invoicedAt: new Date(),
        invoicedBy: office.id,
        updatedBy: office.id,
      })
      .where(eq(tasks.number, number));
  });
}

/** What the database holds about the hours of a task (BT-15): the original, the correction and who made it. */
export async function readTaskHours(number: number): Promise<{
  status: string;
  workedMinutes: number;
  correctedMinutes: number | null;
  correctionReason: string | null;
  correctedByEmail: string | null;
  updatedAt: Date;
}> {
  assertLocalSupabase(process.env);
  return withDb(async (db) => {
    const corrector = alias(profiles, "corrector");
    const [row] = await db
      .select({
        status: tasks.status,
        workedMinutes: taskCompletions.workedMinutes,
        correctedMinutes: taskCompletions.correctedMinutes,
        correctionReason: taskCompletions.correctionReason,
        correctedByEmail: corrector.email,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .innerJoin(taskCompletions, eq(taskCompletions.taskId, tasks.id))
      .leftJoin(corrector, eq(corrector.id, taskCompletions.correctedBy))
      .where(eq(tasks.number, number));
    if (!row) {
      throw new Error(`readTaskHours: no completed task ${number}`);
    }
    return row;
  });
}

/**
 * A colleague corrects the hours behind the back of an open page (BT-15): the correction is
 * written and the task row is touched, so `updated_at` moves like it does for `correctHours`.
 */
export async function correctHoursAsOffice(
  number: number,
  officeEmail: string,
  correctedMinutes: number,
): Promise<void> {
  assertLocalSupabase(process.env);
  await withDb(async (db) => {
    const [office] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, officeEmail.toLowerCase()));
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.number, number));
    if (!office || !task) {
      throw new Error("correctHoursAsOffice: backoffice user or task not found");
    }
    await db
      .update(taskCompletions)
      .set({
        correctedMinutes,
        correctionReason: "E2E-collega",
        correctedBy: office.id,
        correctedAt: new Date(),
      })
      .where(eq(taskCompletions.taskId, task.id));
    await db.update(tasks).set({ updatedBy: office.id }).where(eq(tasks.id, task.id));
  });
}
