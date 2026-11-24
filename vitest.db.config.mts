import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests need a real PostgreSQL (local Supabase); run them with `pnpm test:db`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
  },
});
