import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, type Database } from "@/db/client";
import { customers, profiles, tasks } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";
import type { TaskStatus, WorkType } from "@/lib/tasks/types";
import { parseCustomerListParams, type CustomerListParams } from "@/lib/validation/customer-list";

import { CUSTOMER_PAGE_SIZE } from "./limits";
import { customerMatchCondition } from "./search";

/** One line of the customer list (design B5). */
export type CustomerListRow = {
  id: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  /** All tasks of the customer, cancelled ones included (as in B6). */
  taskCount: number;
  /** The planned day of the latest task as `2026-11-24`, or `null` without tasks. */
  lastTaskDate: string | null;
};

export type CustomerList = {
  /** The parameters that were applied (the page is clamped to an existing one). */
  params: CustomerListParams;
  rows: CustomerListRow[];
  /** Number of customers that match the search text. */
  total: number;
  pageCount: number;
  /** Whether there is any customer at all. Tells "no customers yet" from "no match". */
  hasAnyCustomer: boolean;
};

/** The query behind `getCustomerList`; exported with the database as a parameter for the database test. */
export async function queryCustomerList(
  db: Pick<Database, "select">,
  requested: CustomerListParams,
): Promise<CustomerList> {
  const where = requested.q ? customerMatchCondition(requested.q) : undefined;

  const [[counted], anyCustomer] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(customers)
      .where(where),
    db.select({ id: customers.id }).from(customers).limit(1),
  ]);
  const total = counted.total;
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested.page), pageCount);

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      street: customers.street,
      postalCode: customers.postalCode,
      city: customers.city,
      phone: customers.phone,
      taskCount: sql<number>`count(${tasks.id})::int`,
      lastTaskDate: sql<string | null>`max(${tasks.scheduledDate})`,
    })
    .from(customers)
    .leftJoin(tasks, eq(tasks.customerId, customers.id))
    .where(where)
    .groupBy(customers.id)
    .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
    .limit(CUSTOMER_PAGE_SIZE)
    .offset((page - 1) * CUSTOMER_PAGE_SIZE);

  return {
    params: { q: requested.q, page },
    rows,
    total,
    pageCount,
    hasAnyCustomer: anyCustomer.length > 0,
  };
}

/**
 * The data of B5. Checks the role itself, before anything is read (ADR-0002, rule 3): it holds
 * names, addresses and phone numbers of customers of the client. Throws an `AuthError` for
 * anyone else.
 */
export async function getCustomerList(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<CustomerList> {
  await requireRole("backoffice");
  return queryCustomerList(getDb(), parseCustomerListParams(searchParams));
}

/** A task of a customer, as B6 lists it. */
export type CustomerTaskRow = {
  number: number;
  /** `2026-11-24` and `14:00:00`. */
  scheduledDate: string;
  startTime: string;
  workType: WorkType;
  status: TaskStatus;
  /** Start of the instructions; the list shows the first line. */
  instructions: string;
  technicianName: string | null;
};

/** A customer with his tasks (design B6). */
export type CustomerDetail = {
  id: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tasks: CustomerTaskRow[];
};

const INSTRUCTIONS_PREVIEW_LENGTH = 300;

/** The query behind `getCustomerDetail`; the tasks are the newest first, cancelled ones included. */
export async function queryCustomerDetail(
  db: Pick<Database, "select">,
  id: string,
): Promise<CustomerDetail | null> {
  const [customer] = await db
    .select({
      id: customers.id,
      name: customers.name,
      street: customers.street,
      postalCode: customers.postalCode,
      city: customers.city,
      phone: customers.phone,
      email: customers.email,
      notes: customers.notes,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) {
    return null;
  }
  const technician = alias(profiles, "technician");
  const customerTasks = await db
    .select({
      number: tasks.number,
      scheduledDate: tasks.scheduledDate,
      startTime: tasks.startTime,
      workType: tasks.workType,
      status: tasks.status,
      instructions: sql<string>`left(${tasks.instructions}, ${INSTRUCTIONS_PREVIEW_LENGTH})`,
      technicianName: technician.fullName,
    })
    .from(tasks)
    .leftJoin(technician, eq(technician.id, tasks.assigneeId))
    .where(eq(tasks.customerId, id))
    .orderBy(desc(tasks.scheduledDate), desc(tasks.startTime), desc(tasks.number));
  return { ...customer, tasks: customerTasks };
}

/** The data of B6 for a customer id. Checks the role first; `null` when the customer does not exist. */
export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  await requireRole("backoffice");
  return queryCustomerDetail(getDb(), id);
}
