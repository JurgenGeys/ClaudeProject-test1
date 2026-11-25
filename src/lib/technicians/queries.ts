import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { profiles, tasks } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";
import { openAssigneeStatuses } from "@/lib/tasks/types";

import { sortTechnicians, technicianStatus, type TechnicianStatus } from "./status";

/** One line of the technician list (design B7). */
export type TechnicianRow = {
  id: string;
  fullName: string;
  email: string;
  status: TechnicianStatus;
  /** Tasks that are not finished: Toegewezen and Opgepikt. Cancelled tasks do not count. */
  openTasks: number;
};

/** The query behind the list; `listTechnicians` adds the role check. Exported for the database test. */
export async function queryTechnicians(db: Database): Promise<TechnicianRow[]> {
  const rows = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      email: profiles.email,
      isActive: profiles.isActive,
      invitePending: profiles.invitePending,
      openTasks: sql<number>`count(${tasks.id})::int`,
    })
    .from(profiles)
    .leftJoin(
      tasks,
      and(eq(tasks.assigneeId, profiles.id), inArray(tasks.status, [...openAssigneeStatuses])),
    )
    .where(eq(profiles.role, "technician"))
    .groupBy(profiles.id);

  return sortTechnicians(
    rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      status: technicianStatus(row),
      openTasks: row.openTasks,
    })),
  );
}

/**
 * All technicians for B7. Checks the role itself, like every read function (design
 * chapter 6): the list holds e-mail addresses, so it is for backoffice only. Throws an
 * `AuthError` for anyone else.
 */
export async function listTechnicians(): Promise<TechnicianRow[]> {
  await requireRole("backoffice");
  return queryTechnicians(getDb());
}

/** A technician as the task form offers him (design B2). */
export type AssignableTechnician = { id: string; fullName: string };

/**
 * The technicians a task can be given to (design B2: "enkel actieve techniekers"): active and
 * with a password chosen. Switched-off technicians and invited ones who did not accept yet are
 * left out. This is only the choice list: the Server Action checks again, under a lock.
 */
export async function queryAssignableTechnicians(
  db: Pick<Database, "select">,
): Promise<AssignableTechnician[]> {
  const rows = await db
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles)
    .where(
      and(
        eq(profiles.role, "technician"),
        eq(profiles.isActive, true),
        eq(profiles.invitePending, false),
      ),
    )
    .orderBy(asc(profiles.id));
  return rows.sort((a, b) =>
    a.fullName.localeCompare(b.fullName, "nl-BE", { sensitivity: "base" }),
  );
}

/** The choice list of the task form. Backoffice only, like every read function. */
export async function listAssignableTechnicians(): Promise<AssignableTechnician[]> {
  await requireRole("backoffice");
  return queryAssignableTechnicians(getDb());
}
