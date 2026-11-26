import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { getCompanyPhone } from "@/lib/company";
import { getMyTaskDetail } from "@/lib/tasks/detail";
import { parseTaskNumber } from "@/lib/validation/task-number";

import { MyTaskView } from "./my-task-view";

export const metadata: Metadata = { title: "Taak" };

/**
 * T2: a task of the signed-in technician, by its number (`/my-tasks/1042`), read only. The role
 * is checked first. The task is looked up with the user of the session as its assignee, so a
 * number from the address never gives somebody else's task. A number that is not valid, one that
 * does not exist and a task of a colleague (or one that is not assigned) all give the same
 * "not found" page: nothing leaks.
 */
export default async function MyTaskPage({ params }: PageProps<"/my-tasks/[number]">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("technician");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const number = parseTaskNumber((await params).number);
  const task = number === null ? null : await getMyTaskDetail(number);
  if (!task) {
    notFound();
  }
  // After the session and the task were read: "now" must not be taken before the request is known.
  return <MyTaskView task={task} now={new Date()} officePhone={getCompanyPhone()} />;
}
