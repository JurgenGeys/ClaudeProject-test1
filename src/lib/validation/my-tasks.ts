import { z } from "zod";

/** The tabs of "Mijn taken" (design T1): the open work, and what was finished. */
const myTasksTabSchema = z.enum(["todo", "done"]).catch("todo");
export type MyTasksTab = z.infer<typeof myTasksTabSchema>;

/**
 * The tab from the address (`/my-tasks?tab=done`). Only `todo` and `done` are known; a missing,
 * repeated or unknown value gives the default "Te doen", like the other overviews ignore a value
 * they do not know.
 */
export function parseMyTasksTab(value: unknown): MyTasksTab {
  return myTasksTabSchema.parse(value);
}

/** The address of a tab; "Te doen" is the default and has no parameter. */
export function myTasksHref(tab: MyTasksTab): string {
  return tab === "done" ? "/my-tasks?tab=done" : "/my-tasks";
}
