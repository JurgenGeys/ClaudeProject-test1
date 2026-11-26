/** The tabs of "Mijn taken" (design T1): the open work, and what was finished. */
export type MyTasksTab = "todo" | "done";

/**
 * The tab from the address (`/my-tasks?tab=done`). Only `done` selects the second tab; a
 * missing, repeated or unknown value gives the default "Te doen", like the other overviews
 * ignore a value they do not know.
 */
export function parseMyTasksTab(value: string | string[] | undefined): MyTasksTab {
  return value === "done" ? "done" : "todo";
}

/** The address of a tab; "Te doen" is the default and has no parameter. */
export function myTasksHref(tab: MyTasksTab): string {
  return tab === "done" ? "/my-tasks?tab=done" : "/my-tasks";
}
