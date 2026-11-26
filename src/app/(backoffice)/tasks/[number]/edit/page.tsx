import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { getTaskDetail } from "@/lib/tasks/detail";
import { formatTaskNumber, taskStatusLabel } from "@/lib/tasks/labels";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { canEditTask } from "@/lib/tasks/transitions";
import { listAssignableTechnicians } from "@/lib/technicians/queries";
import { formatTimeOfDay } from "@/lib/time/format";
import { parseTaskNumber } from "@/lib/validation/task-number";

import { TaskForm, type TaskFormEdit } from "../../task-form";

export const metadata: Metadata = { title: "Taak bewerken" };

/**
 * B2 in edit mode (`/tasks/1043/edit`). Same order as the detail page: the role first, then the
 * number, then the task. A task that is Afgewerkt, Gefactureerd or Geannuleerd has no form,
 * only the reason and a way back.
 */
export default async function EditTaskPage({ params }: PageProps<"/tasks/[number]/edit">) {
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const number = parseTaskNumber((await params).number);
  const task = number === null ? null : await getTaskDetail(number);
  if (!task) {
    notFound();
  }

  const label = formatTaskNumber(task.number);
  const back = (
    <Link href={`/tasks/${task.number}`} className="text-sm underline-offset-4 hover:underline">
      ← Terug naar de taak
    </Link>
  );

  if (!canEditTask(task.status)) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        {back}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Taak {label}</h1>
        <p className="mt-2">
          {TASK_ACTION_MESSAGES.notEditable(taskStatusLabel(task.status).toLowerCase())}
        </p>
        <Button asChild className="mt-4 h-11 px-4 md:h-10">
          <Link href={`/tasks/${task.number}`}>Naar de taak</Link>
        </Button>
      </div>
    );
  }

  const technicians = await listAssignableTechnicians();
  const edit: TaskFormEdit = {
    number: task.number,
    version: task.version,
    status: task.status as TaskFormEdit["status"], // `canEditTask` left only these three
    customer: {
      id: task.customer.id,
      name: task.customer.name,
      street: task.customer.street,
      postalCode: task.customer.postalCode,
      city: task.customer.city,
      phone: task.customer.phone,
    },
    locationStreet: task.locationStreet,
    locationPostalCode: task.locationPostalCode,
    locationCity: task.locationCity,
    workType: task.workType,
    instructions: task.instructions,
    scheduledDate: task.scheduledDate,
    startTime: formatTimeOfDay(task.startTime),
    estimatedMinutes: task.estimatedMinutes,
    assignee: task.assignee,
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {back}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Taak {label} bewerken</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Velden met <span className="text-red-700">*</span> zijn verplicht.
      </p>
      <TaskForm technicians={technicians} edit={edit} />
    </div>
  );
}
