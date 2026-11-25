import "server-only";

import { asc, ilike, or, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { customers } from "@/db/schema";

import { CUSTOMER_SEARCH_LIMIT, CUSTOMER_SEARCH_MIN_LENGTH } from "./limits";

/** What the picker needs to show a customer and to fill in the location. */
export type CustomerSearchResult = {
  id: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
};

/** `%`, `_` and `\` have a meaning in LIKE; a typed text must be taken literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Customers whose name, phone number or city contains the text (any case), sorted by name, at
 * most `CUSTOMER_SEARCH_LIMIT` (design B2). Returns nothing for a text that is too short.
 * Exported with the database as a parameter for the database test; the Server Action adds the
 * role check.
 */
export async function findCustomers(db: Pick<Database, "select">, text: string) {
  const term = text.trim();
  if (term.length < CUSTOMER_SEARCH_MIN_LENGTH) {
    return [];
  }
  const pattern = `%${escapeLike(term)}%`;
  return db
    .select({
      id: customers.id,
      name: customers.name,
      street: customers.street,
      postalCode: customers.postalCode,
      city: customers.city,
      phone: customers.phone,
    })
    .from(customers)
    .where(
      or(
        ilike(customers.name, pattern),
        ilike(customers.phone, pattern),
        ilike(customers.city, pattern),
      ),
    )
    .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
    .limit(CUSTOMER_SEARCH_LIMIT);
}
