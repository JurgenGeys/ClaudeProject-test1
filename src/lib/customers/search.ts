import "server-only";

import { asc, ilike, or, sql, type SQL } from "drizzle-orm";

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

/** Every kind of white space in a text, for the comparison of phone numbers. */
export function withoutSpaces(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * The condition "this customer matches the typed text" of the picker (B2) and the list (B5):
 * the name or the city contains the text (any case), or the phone number does. A phone number is
 * compared without spaces on both sides, so `014412287` finds `014 41 22 87` and `014 41`
 * finds `014412287`. The text is a plain value in the query; `%` and `_` are taken literally.
 */
export function customerMatchCondition(text: string): SQL {
  const term = text.trim();
  const pattern = `%${escapeLike(term)}%`;
  const phoneTerm = withoutSpaces(term);
  const conditions = [ilike(customers.name, pattern), ilike(customers.city, pattern)];
  if (phoneTerm !== "") {
    conditions.push(
      sql`regexp_replace(${customers.phone}, '[[:space:]]', '', 'g') ilike ${`%${escapeLike(phoneTerm)}%`}`,
    );
  }
  return or(...conditions) as SQL;
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
    .where(customerMatchCondition(term))
    .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
    .limit(CUSTOMER_SEARCH_LIMIT);
}
