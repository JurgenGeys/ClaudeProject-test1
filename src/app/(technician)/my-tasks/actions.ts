"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import { PICK_UP_MESSAGES, TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { pickUpTaskInTransaction, type PickUpOutcome } from "@/lib/tasks/pick-up";
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
