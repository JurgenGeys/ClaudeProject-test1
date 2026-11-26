import "server-only";

import { eq } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { customers } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";
import { parseCustomerId } from "@/lib/validation/customer-list";

import type { CustomerSearchResult } from "./search";

/** The customer with this id in the shape the picker of the task form needs, or `null`. */
export async function queryCustomerById(
  db: Pick<Database, "select">,
  id: string,
): Promise<CustomerSearchResult | null> {
  const [customer] = await db
    .select({
      id: customers.id,
      name: customers.name,
      street: customers.street,
      postalCode: customers.postalCode,
      city: customers.city,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return customer ?? null;
}

/**
 * The customer for `/tasks/new?customer=<id>` ("Nieuwe taak voor deze klant", design B6). The
 * id comes from the URL: anything that is not a UUID, or a customer that does not exist, gives
 * `null` and the form starts empty. Checks the role first (ADR-0002, rule 3).
 */
export async function getCustomerForNewTask(
  value: string | string[] | undefined,
): Promise<CustomerSearchResult | null> {
  await requireRole("backoffice");
  const id = typeof value === "string" ? parseCustomerId(value) : null;
  return id === null ? null : queryCustomerById(getDb(), id);
}
