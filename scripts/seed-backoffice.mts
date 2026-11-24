/**
 * Creates the first backoffice user: a Supabase Auth user plus the matching `profiles` row.
 * There is no screen to add backoffice users (design, P4), so this runs once, locally.
 *
 *   pnpm seed:backoffice "Sofie Peeters" sofie@example.be
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL (from the environment
 * or `.env.local`). The password comes from SEED_BACKOFFICE_PASSWORD (at least 12 characters)
 * or, when that is not set, is generated and printed once. Running it again is safe: an
 * existing user or profile is left alone.
 *
 * This file stands alone on purpose: it runs with plain Node (no Next.js), so it cannot
 * import `server-only` modules such as `src/lib/supabase/admin.ts`.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { z } from "zod";

const inputSchema = z.object({
  fullName: z.string().trim().min(1, { error: "The name must not be empty." }),
  email: z.email({ error: "The e-mail address is not valid." }).transform((v) => v.toLowerCase()),
});

const passwordSchema = z
  .string()
  .min(12, { error: "SEED_BACKOFFICE_PASSWORD must be at least 12 characters." });

const envSchema = z.object({
  url: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL is not set or not a valid URL." }),
  secretKey: z.string().min(1, { error: "SUPABASE_SECRET_KEY is not set." }),
  databaseUrl: z.string().min(1, { error: "DATABASE_URL is not set." }),
});

export type SeedInput = z.infer<typeof inputSchema>;

export class UsageError extends Error {}

export function parseArgs(args: string[]): SeedInput {
  const parsed = inputSchema.safeParse({ fullName: args[0], email: args[1] });
  if (args.length !== 2 || !parsed.success) {
    const reasons = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    throw new UsageError(
      [
        'Usage: pnpm seed:backoffice "<full name>" <e-mail>',
        ...(args.length !== 2 ? ["Expected exactly two arguments."] : []),
        ...reasons,
      ].join("\n"),
    );
  }
  return parsed.data;
}

/** What `seedBackoffice` needs from the outside world; replaced by fakes in unit tests. */
export type SeedDeps = {
  findAuthUserId(email: string): Promise<string | null>;
  createAuthUser(input: SeedInput & { password: string }): Promise<string>;
  /** Inserts the profile unless one exists; returns the role of the (new or existing) profile. */
  ensureProfile(input: SeedInput & { id: string }): Promise<{ created: boolean; role: string }>;
};

export type SeedResult = {
  authUser: "created" | "existing";
  profile: "created" | "existing";
  generatedPassword?: string;
};

export async function seedBackoffice(
  deps: SeedDeps,
  input: SeedInput,
  options: { password?: string } = {},
): Promise<SeedResult> {
  let id = await deps.findAuthUserId(input.email);
  let generatedPassword: string | undefined;
  const authUser = id ? "existing" : "created";

  if (!id) {
    const password =
      options.password === undefined
        ? (generatedPassword = randomBytes(18).toString("base64url"))
        : passwordSchema.parse(options.password);
    id = await deps.createAuthUser({ ...input, password });
  }

  const profile = await deps.ensureProfile({ ...input, id });
  if (profile.role !== "backoffice") {
    throw new Error(
      `${input.email} already exists with the role "${profile.role}". Nothing was changed.`,
    );
  }

  return {
    authUser,
    profile: profile.created ? "created" : "existing",
    ...(generatedPassword ? { generatedPassword } : {}),
  };
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  const input = parseArgs(process.argv.slice(2));
  const env = envSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    databaseUrl: process.env.DATABASE_URL,
  });

  const supabase = createClient(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(env.databaseUrl, { max: 1, prepare: false });

  try {
    const result = await seedBackoffice(
      {
        async findAuthUserId(email) {
          const rows = await sql<{ id: string }[]>`
            select id from auth.users where lower(email) = ${email} limit 1
          `;
          return rows[0]?.id ?? null;
        },
        async createAuthUser({ email, fullName, password }) {
          const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName },
          });
          if (error || !data.user) {
            throw new Error(
              `Creating the Auth user failed: ${error?.message ?? "no user returned"}`,
            );
          }
          return data.user.id;
        },
        async ensureProfile({ id, email, fullName }) {
          const inserted = await sql<{ role: string }[]>`
            insert into public.profiles (id, email, full_name, role)
            values (${id}, ${email}, ${fullName}, 'backoffice')
            on conflict (id) do nothing
            returning role
          `;
          if (inserted[0]) {
            return { created: true, role: inserted[0].role };
          }
          const existing = await sql<{ role: string }[]>`
            select role from public.profiles where id = ${id}
          `;
          return { created: false, role: existing[0]?.role ?? "unknown" };
        },
      },
      input,
      { password: process.env.SEED_BACKOFFICE_PASSWORD || undefined },
    );

    console.log(`Auth user: ${result.authUser}. Profile: ${result.profile}.`);
    if (result.generatedPassword) {
      console.log(
        `Generated password (shown once, change it after signing in): ${result.generatedPassword}`,
      );
    }
  } finally {
    await sql.end();
  }
}

// Only run when started directly (`node scripts/seed-backoffice.mts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof UsageError ? error.message : error);
    process.exitCode = 1;
  });
}
