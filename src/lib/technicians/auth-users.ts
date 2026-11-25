import "server-only";

import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";

/**
 * Marker in `app_metadata` of a Supabase Auth user that this application created (by
 * inviting a technician). Only the admin API can set `app_metadata`; the user themselves can
 * not, unlike `user_metadata`. An Auth account without a profile is only ever reused when it
 * carries this marker; any other account (for example one that somebody registered by
 * themselves) is refused as a duplicate.
 */
export const INVITED_BY_APP_KEY = "invited_by_app";

export type AuthUserSummary = { id: string; invitedByApp: boolean };

/**
 * Looks up the Auth account with this e-mail address (case-insensitive) in `auth.users`, read
 * through Drizzle like everything else. `null` when there is none.
 */
export async function findAuthUserByEmail(
  db: Pick<Database, "execute">,
  email: string,
): Promise<AuthUserSummary | null> {
  const rows = await db.execute<{ id: string; invited_by_app: string | null }>(sql`
    select id, raw_app_meta_data ->> 'invited_by_app' as invited_by_app
    from auth.users
    where lower(email) = ${email.toLowerCase()}
    limit 1
  `);
  const row = rows[0];
  return row ? { id: row.id, invitedByApp: row.invited_by_app === "true" } : null;
}
