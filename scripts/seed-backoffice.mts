/**
 * Creates the first backoffice user: a Supabase Auth user plus the matching `profiles` row.
 * There is no screen to add backoffice users (design, P4), so this runs once, locally.
 *
 *   pnpm seed:backoffice "Sofie Peeters" sofie@example.be
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL (from the environment
 * or `.env.local`). The password comes from SEED_BACKOFFICE_PASSWORD (at least 12 characters)
 * or, when that is not set, is generated and printed the moment the Auth account exists
 * (so it is never lost when a later step fails). Run `pnpm db:migrate` first. Running it
 * again is safe: an existing user or profile is left alone.
 *
 * It runs with plain Node (no Next.js), so it cannot import `server-only` modules such as
 * `src/lib/supabase/admin.ts` or `src/db/client.ts`. Database access still goes through
 * Drizzle and the shared schema (ADR-0002, rule 1).
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { authUsers } from "drizzle-orm/supabase";
import postgres from "postgres";
import { z } from "zod";

import { profiles, type UserRole } from "../src/db/schema/profiles.ts";

const inputSchema = z.object({
  fullName: z.string().trim().min(1, { error: "The name must not be empty." }),
  email: z.email({ error: "The e-mail address is not valid." }).transform((v) => v.toLowerCase()),
});

const passwordSchema = z
  .string()
  .min(12, { error: "SEED_BACKOFFICE_PASSWORD must be at least 12 characters." });

export type SeedInput = z.infer<typeof inputSchema>;

/** An expected problem (bad arguments, missing setup): shown as a short message, no stack trace. */
export class ScriptError extends Error {}

const USAGE = 'Usage: pnpm seed:backoffice "<full name>" <e-mail>';

export function parseArgs(args: string[]): SeedInput {
  const parsed = inputSchema.safeParse({ fullName: args[0], email: args[1] });
  if (args.length !== 2 || !parsed.success) {
    const reasons = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    throw new ScriptError(
      [USAGE, ...(args.length !== 2 ? ["Expected exactly two arguments."] : []), ...reasons].join(
        "\n",
      ),
    );
  }
  return parsed.data;
}

/** Reads the environment variables the script needs; names every missing one in one message. */
export function readEnv(env: Record<string, string | undefined>): {
  supabaseUrl: string;
  secretKey: string;
  databaseUrl: string;
  password: string | undefined;
} {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "DATABASE_URL"].filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new ScriptError(
      `Missing environment variable(s): ${missing.join(", ")}.\n` +
        "Copy .env.example to .env.local and fill them in (local Supabase: `supabase status -o env`).",
    );
  }
  if (!z.url().safeParse(env.NEXT_PUBLIC_SUPABASE_URL).success) {
    throw new ScriptError("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!,
    secretKey: env.SUPABASE_SECRET_KEY!,
    databaseUrl: env.DATABASE_URL!,
    password: env.SEED_BACKOFFICE_PASSWORD || undefined,
  };
}

/** What `seedBackoffice` needs from the outside world; replaced by fakes in unit tests. */
export type SeedDeps = {
  /** Throws a `ScriptError` when the database is unreachable or `profiles` does not exist. */
  checkDatabase(): Promise<void>;
  findAuthUserId(email: string): Promise<string | null>;
  createAuthUser(input: SeedInput & { password: string }): Promise<string>;
  /** Inserts the profile unless one exists; returns the (new or existing) profile's role and state. */
  ensureProfile(
    input: SeedInput & { id: string },
  ): Promise<{ created: boolean; role: UserRole; isActive: boolean }>;
};

export type SeedResult = {
  authUser: "created" | "existing";
  profile: "created" | "existing";
  /** Things the person running the script should look at. */
  warnings: string[];
};

export async function seedBackoffice(
  deps: SeedDeps,
  input: SeedInput,
  options: {
    password?: string;
    /**
     * Called as soon as the Auth account has been created with a generated password, before
     * anything else can fail. The caller must show it: it cannot be retrieved afterwards.
     */
    onGeneratedPassword?: (password: string) => void;
  } = {},
): Promise<SeedResult> {
  // Validate and check everything that can be checked before the Auth account is created.
  if (options.password !== undefined) {
    const checked = passwordSchema.safeParse(options.password);
    if (!checked.success) {
      throw new ScriptError(checked.error.issues[0].message);
    }
  }
  await deps.checkDatabase();

  const warnings: string[] = [];
  let id = await deps.findAuthUserId(input.email);
  const authUser = id ? "existing" : "created";

  if (!id) {
    const generated = options.password === undefined ? randomBytes(18).toString("base64url") : null;
    id = await deps.createAuthUser({ ...input, password: options.password ?? generated! });
    if (generated) {
      options.onGeneratedPassword?.(generated);
    }
  }

  const profile = await deps.ensureProfile({ ...input, id });
  if (profile.role !== "backoffice") {
    throw new ScriptError(
      `${input.email} already exists with the role "${profile.role}". Nothing was changed.`,
    );
  }
  if (profile.created && authUser === "existing") {
    warnings.push(
      `${input.email} already had a login in Supabase Auth but no profile. A backoffice profile was created: ` +
        "this person can now sign in as backoffice. Check that this is the right account.",
    );
  }
  if (!profile.created && !profile.isActive) {
    warnings.push(
      `The backoffice profile of ${input.email} is deactivated, so this person cannot sign in. It was left as it is.`,
    );
  }

  return { authUser, profile: profile.created ? "created" : "existing", warnings };
}

// Only what the deps use, so a Drizzle transaction fits as well (database tests).
type Db = Pick<PostgresJsDatabase<{ profiles: typeof profiles }>, "select" | "insert">;

/** The database side of the seed script, on Drizzle. Exported so a database test can cover it. */
export function createDatabaseDeps(db: Db): Omit<SeedDeps, "createAuthUser"> {
  return {
    async checkDatabase() {
      try {
        await db.select({ id: profiles.id }).from(profiles).limit(1);
      } catch (error) {
        const cause =
          (error as { cause?: { code?: string } }).cause ?? (error as { code?: string });
        if (cause.code === "42P01") {
          throw new ScriptError(
            'The table "profiles" does not exist. Run `pnpm db:migrate` first.',
          );
        }
        throw new ScriptError(
          `The database is not reachable (check DATABASE_URL, and that Supabase is running): ${
            (cause as Error).message ?? "unknown error"
          }`,
        );
      }
    },
    async findAuthUserId(email) {
      const rows = await db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(sql`lower(${authUsers.email}) = ${email.toLowerCase()}`)
        .limit(1);
      return rows[0]?.id ?? null;
    },
    async ensureProfile({ id, email, fullName }) {
      const inserted = await db
        .insert(profiles)
        .values({ id, email, fullName, role: "backoffice" })
        .onConflictDoNothing({ target: profiles.id })
        .returning({ role: profiles.role, isActive: profiles.isActive });
      if (inserted[0]) {
        return { created: true, ...inserted[0] };
      }
      const existing = await db
        .select({ role: profiles.role, isActive: profiles.isActive })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (!existing[0]) {
        throw new ScriptError(
          `Could not create a profile for ${email}: another profile already uses this e-mail address.`,
        );
      }
      return { created: false, ...existing[0] };
    },
  };
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  const input = parseArgs(process.argv.slice(2));
  const env = readEnv(process.env);

  const supabase = createClient(env.supabaseUrl, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const client = postgres(env.databaseUrl, { max: 1, prepare: false });
  const db = drizzle(client, { schema: { profiles } });

  try {
    const result = await seedBackoffice(
      {
        ...createDatabaseDeps(db),
        async createAuthUser({ email, fullName, password }) {
          const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName },
          });
          if (error || !data.user) {
            throw new ScriptError(
              `Creating the Auth user failed: ${error?.message ?? "no user returned"}`,
            );
          }
          return data.user.id;
        },
      },
      input,
      {
        password: env.password,
        onGeneratedPassword(password) {
          console.log(
            `Auth account created. Generated password (shown once, change it after signing in): ${password}`,
          );
        },
      },
    );

    console.log(`Auth user: ${result.authUser}. Profile: ${result.profile}.`);
    for (const warning of result.warnings) {
      console.warn(`WARNING: ${warning}`);
    }
  } finally {
    await client.end();
  }
}

// Only run when started directly (`node scripts/seed-backoffice.mts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
