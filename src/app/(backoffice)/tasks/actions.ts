"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import { createTaskInTransaction, type CreateTaskOutcome } from "@/lib/tasks/create";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { fieldErrorsOf } from "@/lib/tasks/refusals";
import { taskStatusLabel } from "@/lib/tasks/labels";
import { resetTaskInTransaction, type ResetTaskOutcome } from "@/lib/tasks/reset";
import { updateTaskInTransaction, type UpdateTaskOutcome } from "@/lib/tasks/update";
import { parseResetTaskForm, type ResetTaskFieldErrors } from "@/lib/validation/reset-task";
import { parseUpdateTask, readUpdateTaskForm } from "@/lib/validation/update-task";
import {
  parseCreateTask,
  readCreateTaskForm,
  type CreateTaskFieldErrors,
} from "@/lib/validation/create-task";

/**
 * Result of `createTask` and `updateTask` when the task was not saved. A saved task redirects
 * instead, so there is no success state. The form keeps what was typed itself; nothing is
 * echoed back.
 */
export type TaskFormState = null | {
  ok: false;
  fieldErrors: CreateTaskFieldErrors;
  /** A problem that does not belong to one field (technical problem, no access). */
  formError?: string;
  /** The task changed meanwhile: the form offers a button that reloads the page. */
  reload?: boolean;
};

const TASKS_PATH = "/tasks";
const NEW_TASK_PATH = "/tasks/new";

function refused(formError: string, reload = false): TaskFormState {
  return { ok: false, fieldErrors: {}, formError, ...(reload ? { reload } : {}) };
}

/** Only the kind of error (and the Postgres code): the message of an error can hold form data. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return `${error instanceof Error ? error.name : "error"} ${String((error as { code: unknown }).code)}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

/** Turns what the transaction refused into the message under the right field (design B2). */
function refusal(outcome: Parameters<typeof fieldErrorsOf>[0]): TaskFormState {
  const fieldErrors = fieldErrorsOf(outcome);
  // Without a field it is the actor who was refused: he is a signed-in, active backoffice
  // user, so this is not expected.
  return fieldErrors ? { ok: false, fieldErrors } : refused(LOGIN_MESSAGES.technicalProblem);
}

/**
 * Saves a new task (design B2; BT-08). Order of the steps:
 * 1. `requireRole("backoffice")`;
 * 2. Zod validation on the server: the task with `taskSchema`, a new customer with
 *    `customerSchema` (`parseCreateTask`);
 * 3. one transaction (`createTaskInTransaction`): the technician is read with `FOR SHARE` and
 *    checked, the transition (`createTask`: new to Open or Toegewezen) is checked, then the
 *    new customer and the task are saved. The task number comes from the database;
 * 4. after a refusal the message goes under the field it belongs to. When the technician was
 *    switched off in the meantime, the page is refreshed so the list no longer offers him;
 * 5. after a save the user continues to the task page (B3) with "Taak #1051 bewaard.".
 */
export async function createTask(
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const parsed = parseCreateTask(readCreateTaskForm(formData));
  if (!parsed.ok) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  let outcome: CreateTaskOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      createTaskInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        data: parsed.data,
      }),
    );
  } catch (error) {
    console.error("Saving a task failed:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  if (outcome.kind !== "created") {
    if (outcome.kind === "assignee-inactive" || outcome.kind === "assignee-invited") {
      // Refresh the choice list of the form: the technician must not be offered any more.
      revalidatePath(NEW_TASK_PATH);
    }
    return refusal(outcome);
  }

  revalidatePath(TASKS_PATH);
  // `redirect()` throws, so it stays outside the try/catch above.
  redirect(`${TASKS_PATH}/${outcome.number}?saved=1`);
}

/**
 * Saves the changes to a task (design B2 in edit mode; BT-10). Order of the steps:
 * 1. `requireRole("backoffice")`;
 * 2. Zod validation on the server (`parseUpdateTask`): the fields of the task, the task number
 *    and the version the form was opened with. A form without a valid number or version is
 *    answered like a task that changed: reload;
 * 3. one transaction (`updateTaskInTransaction`): lock the task, check the status and the
 *    version again, check the technician under `FOR SHARE`, then the conditional update;
 * 4. a refusal gives a message under the field it belongs to, or a message for the whole
 *    form (the task changed, is not editable or does not exist);
 * 5. after a save the user continues to B3 with "Taak #1043 bewaard.".
 */
export async function updateTask(
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const parsed = parseUpdateTask(readUpdateTaskForm(formData));
  if (!parsed.ok) {
    return parsed.reason === "stale"
      ? refused(TASK_ACTION_MESSAGES.changed, true)
      : { ok: false, fieldErrors: parsed.fieldErrors };
  }
  const { number } = parsed.data;

  let outcome: UpdateTaskOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      updateTaskInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        data: parsed.data,
      }),
    );
  } catch (error) {
    console.error("Saving a task failed:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  switch (outcome.kind) {
    case "updated":
      break;
    case "not-found":
      return refused(TASK_ACTION_MESSAGES.taskNotFound);
    case "not-editable":
      return refused(
        TASK_ACTION_MESSAGES.notEditable(taskStatusLabel(outcome.status).toLowerCase()),
        true,
      );
    case "changed":
      return refused(TASK_ACTION_MESSAGES.changed, true);
    case "assignee-locked":
      return refused(TASK_ACTION_MESSAGES.assigneeLocked);
    default:
      if (outcome.kind === "assignee-inactive" || outcome.kind === "assignee-invited") {
        // Refresh the choice list of the form: the technician must not be offered any more.
        revalidatePath(`${TASKS_PATH}/${number}/edit`);
      }
      return refusal(outcome);
  }

  revalidatePath(TASKS_PATH);
  revalidatePath(`${TASKS_PATH}/${number}`);
  redirect(`${TASKS_PATH}/${number}?saved=1`);
}

/**
 * Result of `resetTask` when the task was not reset. A reset task redirects instead. The dialog
 * keeps what was chosen itself; nothing is echoed back.
 */
export type ResetTaskState = null | {
  ok: false;
  fieldErrors: ResetTaskFieldErrors;
  /** A problem that does not belong to one field (technical problem, no access, changed). */
  formError?: string;
  /** The task changed meanwhile: the dialog offers a button that reloads the page. */
  reload?: boolean;
};

/**
 * Puts an Opgepikt task back to Toegewezen (design B3 "Terugzetten"; BT-14). Order of the steps:
 * 1. `requireRole("backoffice")`;
 * 2. Zod validation on the server (`parseResetTaskForm`): the task number, the version of the
 *    page, the technician, the date and the start time. The status, `picked_up_at` and the user
 *    are never read from the form. A form without a valid number or version is answered like a
 *    task that changed: reload;
 * 3. one transaction (`resetTaskInTransaction`): lock the task, check the status and version
 *    again, check the technician under `FOR SHARE`, `checkTransition`, the conditional update;
 * 4. a refusal gives a message under the field it belongs to, or one for the whole dialog (the
 *    task changed or does not exist). A technician who finished or picked up meanwhile is
 *    told so by his own screens (BT-12, BT-13);
 * 5. after a reset the user continues to B3 with "Taak teruggezet. ...".
 */
export async function resetTask(
  _previous: ResetTaskState,
  formData: FormData,
): Promise<ResetTaskState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, fieldErrors: {}, formError: authFailureMessage(error) };
    }
    throw error;
  }

  const parsed = parseResetTaskForm(formData);
  if (!parsed.ok) {
    return parsed.reason === "stale"
      ? { ok: false, fieldErrors: {}, formError: TASK_ACTION_MESSAGES.changed, reload: true }
      : { ok: false, fieldErrors: parsed.fieldErrors };
  }
  const { number } = parsed.data;

  let outcome: ResetTaskOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      resetTaskInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        data: parsed.data,
      }),
    );
  } catch (error) {
    console.error("Resetting a task failed:", describeError(error));
    return { ok: false, fieldErrors: {}, formError: LOGIN_MESSAGES.technicalProblem };
  }

  switch (outcome.kind) {
    case "reset":
      break;
    case "not-found":
      return { ok: false, fieldErrors: {}, formError: TASK_ACTION_MESSAGES.taskNotFound };
    case "changed":
      return { ok: false, fieldErrors: {}, formError: TASK_ACTION_MESSAGES.changed, reload: true };
    default: {
      if (outcome.kind === "assignee-inactive" || outcome.kind === "assignee-invited") {
        // Refresh the choice list of the dialog: the technician must not be offered any more.
        revalidatePath(`${TASKS_PATH}/${number}`);
      }
      const fieldErrors = fieldErrorsOf(outcome);
      // Without a field it is the actor who was refused: he is a signed-in, active backoffice
      // user, so this is not expected.
      return fieldErrors
        ? { ok: false, fieldErrors }
        : { ok: false, fieldErrors: {}, formError: LOGIN_MESSAGES.technicalProblem };
    }
  }

  revalidatePath(TASKS_PATH);
  revalidatePath(`${TASKS_PATH}/${number}`);
  // The technician sees the task as Toegewezen again, with the new date.
  revalidatePath("/my-tasks");
  revalidatePath(`/my-tasks/${number}`);
  // `redirect()` throws, so it stays outside the try/catch above.
  redirect(`${TASKS_PATH}/${number}?reset=1`);
}
