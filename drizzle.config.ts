import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env.local itself. Existing environment variables win.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// `generate` only compares the schema with earlier migrations and needs no database.
const needsDatabase = !process.argv.includes("generate");
const url = process.env.DATABASE_URL;

if (needsDatabase && !url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the connection string.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  ...(url ? { dbCredentials: { url } } : {}),
});
