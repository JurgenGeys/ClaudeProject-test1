import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same as drizzle.config.ts: existing environment variables win over .env.local.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// Database tests need a real PostgreSQL (local Supabase); run them with `pnpm test:db`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.{ts,tsx}"],
    // One database, shared by all files. Most tests run in a transaction that is rolled back, but
    // the race tests (two connections that see each other's locks) commit their tasks and remove
    // them afterwards. A test that counts tasks in the whole table (`task-overview.db.test.ts`,
    // before and after its own seed) sees those commits when files run side by side, and fails
    // now and then, depending on timing. So the files run one after the other.
    fileParallelism: false,
  },
});
