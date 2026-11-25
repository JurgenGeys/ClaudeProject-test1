import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./profiles";

/**
 * Customers of the client (design chapter 5). Everything except the name is optional: a
 * customer can be created quickly from the task form. Nothing is ever deleted in the first
 * version, so every foreign key to this table is `ON DELETE RESTRICT`.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    // Not maintained by the database: the Server Action sets it on every update.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Customer search by name (B2, B5), case insensitive.
    index("customers_lower_name_idx").on(sql`lower(${table.name})`),
  ],
  // Row Level Security without policies: the public Supabase API can do nothing with this table.
).enableRLS();

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
