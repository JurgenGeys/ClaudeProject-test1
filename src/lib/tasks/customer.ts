import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { customers } from "@/db/schema";
import type { CreateTaskCustomer } from "@/lib/validation/create-task";

/** Whether the customer exists (nothing is deleted, so a missing one is a forged id). */
export async function customerExists(
  tx: Pick<Database, "select">,
  customerId: string,
): Promise<boolean> {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return customer !== undefined;
}

/**
 * The id of the customer of a task: an existing one as it is, a new one is saved first
 * (`created_by` = the actor). Call it after every check, so a refusal leaves nothing behind.
 */
export async function resolveCustomerId(
  tx: Pick<Database, "insert">,
  actorId: string,
  customer: CreateTaskCustomer,
): Promise<string> {
  if (customer.kind === "existing") {
    return customer.id;
  }
  const [created] = await tx
    .insert(customers)
    .values({ ...customer.data, createdBy: actorId })
    .returning({ id: customers.id });
  return created.id;
}
