import type { Metadata } from "next";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { getMyTasks } from "@/lib/tasks/my-tasks";
import { parseMyTasksTab } from "@/lib/validation/my-tasks";

import { MyTaskTabs } from "./my-task-tabs";
import { DoneList, TodoList } from "./my-task-lists";

export const metadata: Metadata = { title: "Mijn taken" };

/**
 * T1: the tasks of the signed-in technician, in two tabs (`?tab=done` for "Afgewerkt"). The
 * tasks are read for the user of the session; nothing in the address decides whose tasks.
 */
export default async function MyTasksPage({ searchParams }: PageProps<"/my-tasks">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  // The lookup is cached per request, so this costs nothing extra.
  const access = await checkRoleAccess("technician");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const tab = parseMyTasksTab((await searchParams).tab);
  // After the session was read: "now" must not be taken before the request is known.
  const now = new Date();
  const result = await getMyTasks(tab, now);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Mijn taken</h1>
      <MyTaskTabs current={tab} />
      {result.tab === "todo" ? (
        <TodoList tasks={result.tasks} now={now} />
      ) : (
        <DoneList tasks={result.tasks} now={now} />
      )}
    </>
  );
}
