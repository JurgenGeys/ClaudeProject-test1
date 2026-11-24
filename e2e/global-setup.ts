import { STATIC_USERS } from "./support/test-users";
import { ensureUser } from "./support/users";

/** Creates the users the tests sign in with, once per run, through the admin API and Drizzle. */
export default async function globalSetup(): Promise<void> {
  for (const user of STATIC_USERS) {
    await ensureUser(user);
  }
}
