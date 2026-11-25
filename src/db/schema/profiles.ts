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
  ],
  // Row Level Security without policies: the public Supabase API can do nothing with this table.
).enableRLS();

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
