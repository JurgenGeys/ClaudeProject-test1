import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { getCompanyPhone } from "@/lib/company";
import { getMyTaskDetail } from "@/lib/tasks/detail";
import { parseTaskNumber } from "@/lib/validation/task-number";

import { CompleteTaskForm } from "./complete-task-form";

export const metadata: Metadata = { title: "Taak afmelden" };

/**
 * T3: finish a task (`/my-tasks/1042/complete`). The role is checked first and the task is
 * looked up with the user of the session as its assignee: a colleague's task, an unknown number
 * and a number that is not valid all give the "not found" page. Only an Opgepikt task can be
 * finished; for any other status (not picked up yet, already finished, cancelled) the technician
 * goes to T2, which shows what is true for that task.
 */
export default async function CompleteTaskPage({
  params,
}: PageProps<"/my-tasks/[number]/complete">) {
  const access = await checkRoleAccess("technician");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const number = parseTaskNumber((await params).number);
  const task = number === null ? null : await getMyTaskDetail(number);
  if (!task) {
    notFound();
  }
  if (task.status !== "picked_up") {
    redirect(`/my-tasks/${task.number}`);
  }
  return (
    <CompleteTaskForm
      taskNumber={task.number}
      version={task.version}
      customerName={task.customer.name}
      scheduledDate={task.scheduledDate}
      startTime={task.startTime}
      now={new Date()}
      officePhone={getCompanyPhone()}
    />
  );
}
