"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import { completeTaskInTransaction, type CompleteOutcome } from "@/lib/tasks/complete";
import { COMPLETE_MESSAGES, PICK_UP_MESSAGES, TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { pickUpTaskInTransaction, type PickUpOutcome } from "@/lib/tasks/pick-up";
import {
  parseCompleteTaskForm,
  type CompleteTaskFieldErrors,
} from "@/lib/validation/complete-task";
import { fieldSummary } from "@/lib/validation/field-summary";
import { COMPLETION_MESSAGES } from "@/lib/validation/messages";
import { parsePickUpTaskForm } from "@/lib/validation/pick-up-task";

/**
 * Result of `pickUpTask`. `kind` tells the screen what to show:
 * - `picked-up`: done; the page shows "Opgepikt om 08:12";
 * - `not-assigned` and `changed`: a message at the top of the page (design T2 and chapter 3);
 * - `cancelled`: the page itself now shows "Deze taak is geannuleerd door kantoor";
 * - `error`: a message in the dialog (technical problem, no access, switched off).
 */
export type PickUpTaskState =
  | null
  | { ok: true }
  | { ok: false; kind: "not-assigned" | "changed" | "cancelled" | "error"; message: string };

const MY_TASKS_PATH = "/my-tasks";
const TASKS_PATH = "/tasks";

function refused(
  kind: Extract<PickUpTaskState, { ok: false }>["kind"],
  message: string,
): PickUpTaskState {
  return { ok: false, kind, message };
}

/** Only the kind of error (and the Postgres code): the message of an error can hold data. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return `${error instanceof Error ? error.name : "error"} ${String((error as { code: unknown }).code)}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Picks up a task (design T2, K5; BT-12). Order of the steps (design chapter 6):
 * 1. `requireRole("technician")`: an active technician; the technician is the user of the
 *    session, never something from the form;
 * 2. Zod validation on the server: only the task number and the version are read from the form;
 * 3. one transaction (`pickUpTaskInTransaction`): lock the task, check that it is his and
 *    Toegewezen, the version, then the conditional update with the time of the database;
 * 4. a refusal gives the message of the design: no longer assigned to him, changed meanwhile,
 *    cancelled by the office, or switched off. Nothing of the office is ever overwritten.
 * Having other picked up tasks is no reason to refuse (K5).
 */
export async function pickUpTask(
  _previous: PickUpTaskState,
  formData: FormData,
): Promise<PickUpTaskState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("technician");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused("error", authFailureMessage(error));
    }
    throw error;
  }

  const parsed = parsePickUpTaskForm(formData);
  if (!parsed.ok) {
    // Not a form that this page made: answered like a task that changed.
    return refused("changed", TASK_ACTION_MESSAGES.changed);
  }
  const { number, version } = parsed.data;

  let outcome: PickUpOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      pickUpTaskInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        number,
        version,
      }),
    );
  } catch (error) {
    console.error("Picking up a task failed:", describeError(error));
    return refused("error", LOGIN_MESSAGES.technicalProblem);
  }

  switch (outcome.kind) {
    case "picked-up":
    case "already-picked-up":
      // (Already picked up by him: the same, the page shows the original "Opgepikt om".)
      // The office sees the new status in the overview and on the task page.
      revalidatePath(MY_TASKS_PATH);
      revalidatePath(`${MY_TASKS_PATH}/${number}`);
      revalidatePath(TASKS_PATH);
      revalidatePath(`${TASKS_PATH}/${number}`);
      return { ok: true };
    case "not-assigned":
      // No revalidation: it could re-render this page as "not found" and take the message away.
      // The list is read afresh when the technician goes back to it.
      return refused("not-assigned", PICK_UP_MESSAGES.notAssigned);
    case "cancelled":
      revalidatePath(MY_TASKS_PATH);
      // The page now shows that the task is cancelled.
      revalidatePath(`${MY_TASKS_PATH}/${number}`);
      return refused("cancelled", PICK_UP_MESSAGES.cancelled);
    case "changed":
      // No revalidation, like above: the button "Pagina herladen" reads the page again.
      return refused("changed", TASK_ACTION_MESSAGES.changed);
    case "inactive":
      return refused("error", LOGIN_MESSAGES.accountDisabled);
    case "refused":
      // An active technician is not refused for another reason: not expected.
      return refused("error", LOGIN_MESSAGES.technicalProblem);
  }
}

/**
 * Result of `completeTask` when the task was not completed (a completed task redirects):
 * - `fields`: hours or notes are wrong; `fieldErrors` hold the messages (design T3);
 * - `not-assigned`, `changed`, `cancelled`: what happened to the task meanwhile (design T2/T3);
 * - `error`: a technical problem, no access or switched off. What he typed stays on the screen.
 */
export type CompleteTaskState =
  | null
  | {
      ok: false;
      kind: "fields";
      message: string;
      fieldErrors: CompleteTaskFieldErrors;
    }
  | { ok: false; kind: "not-assigned" | "changed" | "cancelled" | "error"; message: string };

/**
 * Completes a task (design T3; BT-13). The same order of steps as `pickUpTask`:
 * 1. `requireRole("technician")`; the technician is the user of the session;
 * 2. Zod validation on the server: only the task number, the version, the minutes and the notes
 *    are read from the form;
 * 3. one transaction (`completeTaskInTransaction`): lock the task and his profile, the rules, the
 *    version, the completion row and the new status, with the time of the database;
 * 4. a refusal gives the message of the design; a double completion with the same data is a
 *    silent success (no second row); success goes to Mijn taken with "Taak afgemeld. Bedankt!".
 */
export async function completeTask(
  _previous: CompleteTaskState,
  formData: FormData,
): Promise<CompleteTaskState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("technician");
  } catch (error) {
    if (error instanceof AuthError) {
      return refusedCompletion("error", authFailureMessage(error));
    }
    throw error;
  }

  const parsed = parseCompleteTaskForm(formData);
  if (!parsed.ok) {
    if (parsed.kind === "invalid-form") {
      return refusedCompletion("changed", TASK_ACTION_MESSAGES.changed);
    }
    const count = Object.keys(parsed.fieldErrors).length;
    return {
      ok: false,
      kind: "fields",
      message:
        count === 1 && parsed.fieldErrors.workedMinutes === COMPLETION_MESSAGES.minutesRequired
          ? COMPLETE_MESSAGES.summaryHours
          : fieldSummary(count),
      fieldErrors: parsed.fieldErrors,
    };
  }
  const { number, version, workedMinutes, notes } = parsed.data;

  let outcome: CompleteOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      completeTaskInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        number,
        version,
        workedMinutes,
        notes,
      }),
    );
  } catch (error) {
    console.error("Completing a task failed:", describeError(error));
    return refusedCompletion("error", LOGIN_MESSAGES.technicalProblem);
  }

  switch (outcome.kind) {
    case "completed":
    case "already-completed":
      revalidatePath(MY_TASKS_PATH);
      revalidatePath(`${MY_TASKS_PATH}/${number}`);
      revalidatePath(TASKS_PATH);
      revalidatePath(`${TASKS_PATH}/${number}`);
      // `redirect()` throws, so it stays outside the try/catch above.
      redirect(`${MY_TASKS_PATH}?completed=1`);
    case "not-assigned":
      // No revalidation: it could re-render this page as "not found" and take the message away.
      return refusedCompletion("not-assigned", PICK_UP_MESSAGES.notAssigned);
    case "cancelled":
      revalidatePath(`${MY_TASKS_PATH}/${number}`);
      return refusedCompletion("cancelled", PICK_UP_MESSAGES.cancelled);
    case "changed":
      // No revalidation, like pickUpTask: the button "Pagina herladen" reads the page again.
      return refusedCompletion("changed", TASK_ACTION_MESSAGES.changed);
    case "inactive":
      return refusedCompletion("error", LOGIN_MESSAGES.accountDisabled);
    case "refused":
      // An active technician with valid hours is not refused for another reason.
      return refusedCompletion("error", LOGIN_MESSAGES.technicalProblem);
  }
}

function refusedCompletion(
  kind: "not-assigned" | "changed" | "cancelled" | "error",
  message: string,
): CompleteTaskState {
  return { ok: false, kind, message };
}
