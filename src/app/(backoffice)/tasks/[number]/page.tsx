import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { getTaskDetail } from "@/lib/tasks/detail";
import { listAssignableTechnicians } from "@/lib/technicians/queries";
import { parseTaskNumber } from "@/lib/validation/task-number";

import { TaskDetailView } from "../task-detail";

export const metadata: Metadata = { title: "Taak" };

/**
 * B3: the task for the back office, by its number (`/tasks/1043`). The role is checked first, so
 * nobody else learns whether a task exists. A number that is not valid and a number that does
 * not exist give the same "not found" page.
 */
export default async function TaskDetailPage({
  params,
  searchParams,
}: PageProps<"/tasks/[number]">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const number = parseTaskNumber((await params).number);
  const task = number === null ? null : await getTaskDetail(number);
  if (!task) {
    notFound();
  }
  const { saved, reset } = await searchParams;
  // Only "Terugzetten" (Opgepikt) needs the choice list of technicians.
  const technicians = task.status === "picked_up" ? await listAssignableTechnicians() : [];

  return (
    <TaskDetailView
      task={task}
      saved={saved === "1"}
      reset={reset === "1"}
      technicians={technicians}
    />
  );
}
