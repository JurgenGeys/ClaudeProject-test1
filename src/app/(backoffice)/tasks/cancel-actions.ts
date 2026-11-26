"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import { cancelTaskInTransaction, type CancelTaskOutcome } from "@/lib/tasks/cancel";
import { CANCEL_MESSAGES } from "@/lib/tasks/cancel-messages";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { parseCancelTaskForm, type CancelTaskFieldErrors } from "@/lib/validation/cancel-task";

/**
 * Result of `cancelTask` when the task was not cancelled. A cancelled task redirects instead.
 * Nothing is echoed back: the dialog sends its form by hand (not with `action=`), so React does
 * not clear it and a refused dialog keeps the reason that was typed.
 */
export type CancelTaskState = null | {
  ok: false;
  fieldErrors: CancelTaskFieldErrors;
  /** A problem that does not belong to one field (technical problem, no access, changed). */
  formError?: string;
  /** The task changed meanwhile: the dialog offers a button that reloads the page. */
  reload?: boolean;
};

const TASKS_PATH = "/tasks";

/** Only the kind of error (and the Postgres code): the message of an error can hold form data. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return `${error instanceof Error ? error.name : "error"} ${String((error as { code: unknown }).code)}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

function refused(formError: string, reload = false): CancelTaskState {
  return { ok: false, fieldErrors: {}, formError, ...(reload ? { reload } : {}) };
}

/**
 * Cancels an Open or Toegewezen task (design B3 "Taak annuleren"; BT-14b, `cancelTask`). Order
 * of the steps:
 * 1. `requireRole("backoffice")`;
 * 2. Zod validation on the server (`parseCancelTaskForm`): the task number, the version of the
 *    page and the reason. The status, the user and the time are never read from the form. A
 *    form without a valid number or version is answered like a task that changed: reload;
 * 3. one transaction (`cancelTaskInTransaction`): lock the task, check the status and version
 *    again, `checkTransition`, the conditional update;
 * 4. a refusal gives a message for the whole dialog: the technician picked the task up
 *    meanwhile (call him first), or the task changed or does not exist. A technician who picks
 *    up or finishes with an old page is told so by his own screens (BT-12, BT-13);
 * 5. after a cancellation the user continues to B3 with "Taak #1043 is geannuleerd.", and the
 *    pages of the technician are refreshed (the task disappears from his list).
 */
export async function cancelTask(
  _previous: CancelTaskState,
  formData: FormData,
): Promise<CancelTaskState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const parsed = parseCancelTaskForm(formData);
  if (!parsed.ok) {
    return parsed.reason === "stale"
      ? refused(TASK_ACTION_MESSAGES.changed, true)
      : { ok: false, fieldErrors: parsed.fieldErrors };
  }
  const { number } = parsed.data;

  let outcome: CancelTaskOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      cancelTaskInTransaction(tx, {
        // `requireRole` only returns an active user; the transaction does not read his profile again.
        actor: { id: actor.id, role: actor.role, isActive: true },
        data: parsed.data,
      }),
    );
  } catch (error) {
    console.error("Cancelling a task failed:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  switch (outcome.kind) {
    case "cancelled":
      break;
    case "not-found":
      return refused(TASK_ACTION_MESSAGES.taskNotFound);
    case "picked-up":
      return refused(
        outcome.technicianName
          ? CANCEL_MESSAGES.pickedUp(outcome.technicianName)
          : CANCEL_MESSAGES.pickedUpUnknown,
        true,
      );
    case "changed":
      return refused(TASK_ACTION_MESSAGES.changed, true);
    case "refused":
      // A signed-in, active backoffice user is not refused: not expected.
      return refused(LOGIN_MESSAGES.technicalProblem);
  }

  revalidatePath(TASKS_PATH);
  revalidatePath(`${TASKS_PATH}/${number}`);
  // The technician no longer sees the task in his list; its page says it was cancelled.
  revalidatePath("/my-tasks");
  revalidatePath(`/my-tasks/${number}`);
  // `redirect()` throws, so it stays outside the try/catch above.
  redirect(`${TASKS_PATH}/${number}?cancelled=1`);
}
