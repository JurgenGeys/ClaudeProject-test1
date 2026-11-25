"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import { createTaskInTransaction, type CreateTaskOutcome } from "@/lib/tasks/create";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { TASK_MESSAGES } from "@/lib/validation/messages";
import {
  parseCreateTask,
  readCreateTaskForm,
  type CreateTaskFieldErrors,
} from "@/lib/validation/create-task";

/**
 * Result of `createTask` when the task was not saved. A saved task redirects instead, so there
 * is no success state. The form keeps what was typed itself; nothing is echoed back.
 */
export type CreateTaskState = null | {
  ok: false;
  fieldErrors: CreateTaskFieldErrors;
  /** A problem that does not belong to one field (technical problem, no access). */
  formError?: string;
};

const TASKS_PATH = "/tasks";
const NEW_TASK_PATH = "/tasks/new";

function refused(formError: string): CreateTaskState {
  return { ok: false, fieldErrors: {}, formError };
}

/** Only the kind of error (and the Postgres code): the message of an error can hold form data. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return `${error instanceof Error ? error.name : "error"} ${String((error as { code: unknown }).code)}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

/** Turns what the transaction refused into the message under the right field (design B2). */
function refusal(outcome: Exclude<CreateTaskOutcome, { kind: "created" }>): CreateTaskState {
  switch (outcome.kind) {
    case "customer-not-found":
      return { ok: false, fieldErrors: { customerId: TASK_ACTION_MESSAGES.customerNotFound } };
    case "assignee-not-found":
      return { ok: false, fieldErrors: { assigneeId: TASK_MESSAGES.assigneeInvalid } };
    case "assignee-inactive":
      return {
        ok: false,
        fieldErrors: { assigneeId: TASK_ACTION_MESSAGES.assigneeInactive(outcome.fullName) },
      };
    case "assignee-invited":
      return {
        ok: false,
        fieldErrors: { assigneeId: TASK_ACTION_MESSAGES.assigneeInvited(outcome.fullName) },
      };
    case "refused":
      // The actor is a signed-in, active backoffice user, so this is not expected.
      return refused(LOGIN_MESSAGES.technicalProblem);
  }
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
 * 5. after a save, `/tasks` shows "Taak #1051 bewaard.". The design continues to the task page
 *    (B3), which BT-10 builds; until then the overview is the place to land.
 */
export async function createTask(
  _previous: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
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
  redirect(`${TASKS_PATH}?saved=${outcome.number}`);
}
