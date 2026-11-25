import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Same as drizzle.config.ts: existing environment variables win over .env.local.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// The build shows this name on the login screen and a test checks it; CI sets the same value.
process.env.NEXT_PUBLIC_COMPANY_NAME ||= "FrisAir Koeltechniek";

const port = 3000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Creates the test users in the local Supabase (needs the variables of .env.example).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Tests run against a production build, as close as possible to the real app.
    command: `pnpm build && pnpm start --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
