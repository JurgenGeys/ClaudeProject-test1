/**
 * Task status and kind of work: the single place where their allowed values are listed
 * (design chapter 4 and 5). Plain constants without imports, so Client Components, the
 * Zod schemas and the database schema can all use them.
 *
 * BT-05 builds the Postgres enums from these lists (`pgEnum("task_status", taskStatuses)`),
 * the same way `userRoleEnum` is built from `userRoles`, so the code and the database
 * cannot drift apart.
 */

/** Database values of `task_status`, in the order of the normal flow (cancelled last). */
export const taskStatuses = [
  "open",
  "assigned",
  "picked_up",
  "completed",
  "invoiced",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

/**
 * The "open" tasks of a technician (design B7): assigned to them and not finished yet. Cancelled
 * tasks do not count. Used for the "Open taken" column and for the rule that a technician with
 * open tasks cannot be switched off.
 */
export const openAssigneeStatuses = [
  "assigned",
  "picked_up",
] as const satisfies readonly TaskStatus[];

/** Database values of `work_type` (proposal P6). */
export const workTypes = ["inspection", "maintenance", "repair"] as const;
export type WorkType = (typeof workTypes)[number];
