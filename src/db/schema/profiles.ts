import { sql } from "drizzle-orm";
import { boolean, check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import { userRoles } from "../../lib/auth/roles";

// Re-exported so existing imports from the schema keep working; the list lives in `roles.ts`.
export { userRoles, type UserRole } from "../../lib/auth/roles";

export const userRoleEnum = pgEnum("user_role", userRoles);

/**
 * One profile per Supabase Auth user: Auth owns the login (e-mail, password), this
 * table owns the application data (role, name, active or not).
 *
 * `authUsers` only describes `auth.users` so the foreign key can be generated. It is
 * not exported from `./index.ts` and `drizzle.config.ts` restricts drizzle-kit to the
 * `public` schema, so drizzle-kit never creates or changes anything in `auth`.
 */
export const profiles = pgTable(
  "profiles",
  {
    // A user is deactivated, never deleted, so hours stay traceable (design chapter 5).
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    // Copy of the Auth e-mail address for display and lookups without reading `auth.users`.
    email: text("email").notNull().unique(),
    role: userRoleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // True from the moment a technician is invited until they chose a password. Until then the
    // session that the invitation link creates may only be used to set that password
    // (`getAuthState` reports it as `password-pending`).
    invitePending: boolean("invite_pending").notNull().default(false),
    // When the invitation link was verified (server time, set by the confirm action). The
    // temporary session of a pending user ends 24 hours after this moment (`isInviteSessionExpired`).
    // Cleared when the password is chosen.
    inviteVerifiedAt: timestamp("invite_verified_at", { withTimezone: true }),
    // The temporary session that a "wachtwoord vergeten" link creates for an active user (BT-06b).
    // `recovery_session_id` is the Auth session (`session_id` claim) that may only be used to
    // choose a new password, `recovery_verified_at` the server time of the click. Per session,
    // not per user: the other sessions of this user (a phone that is already signed in) keep
    // working until the password is chosen. Both are cleared when the password is chosen or the
    // reset is cancelled; they are always set together.
    recoverySessionId: uuid("recovery_session_id"),
    recoveryVerifiedAt: timestamp("recovery_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when the user is deactivated, cleared again on reactivation.
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (table) => [
    // `is_active` and `deactivated_at` can never contradict each other.
    check(
      "profiles_active_matches_deactivated_at",
      sql`${table.isActive} = (${table.deactivatedAt} is null)`,
    ),
    // A recovery session always has its moment, and the other way around.
    check(
      "profiles_recovery_session_complete",
      sql`(${table.recoverySessionId} is null) = (${table.recoveryVerifiedAt} is null)`,
    ),
  ],
  // Row Level Security without policies: the public Supabase API can do nothing with this table.
).enableRLS();

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
