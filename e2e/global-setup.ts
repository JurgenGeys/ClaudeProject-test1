import { assertLocalSupabase } from "../src/lib/supabase/local-only";

import { STATIC_USERS } from "./support/test-users";
import { ensureUser } from "./support/users";

/** Creates the users the tests sign in with, once per run, through the admin API and Drizzle. */
export default async function globalSetup(): Promise<void> {
  // Hard stop before anything is created: never run against a real Supabase project.
  assertLocalSupabase(process.env);
  for (const user of STATIC_USERS) {
    await ensureUser(user);
  }
}
