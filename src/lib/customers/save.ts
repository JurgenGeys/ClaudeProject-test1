import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { customers } from "@/db/schema";
import type { CustomerInput } from "@/lib/validation/customer";

/** Saves a new customer (`created_by` = the actor) and returns its id. */
export async function insertCustomer(
  db: Pick<Database, "insert">,
  actorId: string,
  data: CustomerInput,
): Promise<string> {
  const [created] = await db
    .insert(customers)
    .values({ ...data, createdBy: actorId })
    .returning({ id: customers.id });
  return created.id;
}

/**
 * Saves the fields of a customer. Only those fields change: `created_by` and `created_at` stay,
 * `updated_at` is set by Drizzle. Tasks are not touched: a task has its own location (design
 * B6). Returns `false` when the customer does not exist.
 *
 * Nothing guards against two people editing the same customer at the same moment: the last
 * save wins (the design asks for no version check on B6).
 */
export async function updateCustomerFields(
  db: Pick<Database, "update">,
  id: string,
  data: CustomerInput,
): Promise<boolean> {
  const updated = await db
    .update(customers)
    .set(data)
    .where(eq(customers.id, id))
    .returning({ id: customers.id });
  return updated.length > 0;
}
