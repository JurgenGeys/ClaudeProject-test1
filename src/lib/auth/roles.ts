/**
 * Roles of the application, in one module without imports so the database schema, the pure
 * task rules and Client Components can all use it. The managing director uses `backoffice`
 * too (assumption A15). `profiles.ts` builds the Postgres enum `user_role` from this list.
 */
export const userRoles = ["backoffice", "technician"] as const;
export type UserRole = (typeof userRoles)[number];
