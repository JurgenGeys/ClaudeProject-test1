import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./profiles";

/**
 * The temporary sessions that a "wachtwoord vergeten" link created (BT-06b). A row means: the
 * Auth session with this id may only be used to choose a new password, for 24 hours after
 * `verified_at` (`getAuthState` reports it as `reset-pending`, later `reset-expired`).
 *
 * Per session, in a table of its own (decision Jurgen, 25/11/2026): a user can have several
 * recovery sessions at once (two links on two devices), each restricted on its own, and no
 * session can lift the restriction of another. Other sessions of the same user (a phone that is
 * signed in already) have no row and keep working until the password is chosen.
 *
 * Rows go away when the password is chosen (all rows of that user, together with the end of the
 * other sessions), when a reset is cancelled (the row of that session only) and when an expired
 * session is ended. An expired row is deliberately kept until its session is ended: deleting it
 * would turn the session into a normal one.
 */
export const recoverySessions = pgTable(
  "recovery_sessions",
  {
    // The `session_id` claim of the access token; stays the same when the token is refreshed.
    sessionId: uuid("session_id").primaryKey(),
    // A user is deactivated, never deleted (design chapter 5): ON DELETE RESTRICT.
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    // Database clock, so the 24 hours run on a clock that the visitor cannot touch.
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recovery_sessions_user_id_idx").on(table.userId)],
  // Row Level Security without policies: the public Supabase API can do nothing with this table.
).enableRLS();

export type RecoverySession = typeof recoverySessions.$inferSelect;
