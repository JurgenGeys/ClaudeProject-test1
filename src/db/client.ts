import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema> & {
  $client: postgres.Sql;
};

// In development, hot reload re-evaluates this module. Keeping the client on
// globalThis stops every reload from opening a new connection pool.
const globalForDb = globalThis as unknown as { __database?: Database };

let database: Database | undefined;

/**
 * Returns the shared Drizzle client. The connection is created on first use, so
 * importing this module (for example during `next build`) never needs DATABASE_URL.
 */
export function getDb(): Database {
  const existing = database ?? globalForDb.__database;
  if (existing) {
    return existing;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the connection string.",
    );
  }

  // `prepare: false` keeps the client compatible with Supabase's transaction pooler.
  database = drizzle(postgres(url, { prepare: false }), { schema });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__database = database;
  }
  return database;
}
