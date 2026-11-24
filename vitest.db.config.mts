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
  },
});
