"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import {
  markInvoicedInTransaction,
  unmarkInvoicedInTransaction,
  type MarkInvoicedOutcome,
  type UnmarkInvoicedOutcome,
} from "@/lib/tasks/invoice";
import { INVOICE_MESSAGES } from "@/lib/tasks/invoice-messages";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { parseMarkInvoicedForm, parseUnmarkInvoicedForm } from "@/lib/validation/invoice";

/**
 * Result of `markInvoiced`:
 * - `ok: true`: at least one task was marked; `problems` lists what was left out;
 * - `kind: "nothing"`: the database answered but no task was marked (`problems` says why);
 * - `kind: "error"`: a technical problem or no access (`message`); nothing is known to have changed.
 * Marking from the page of one task redirects instead (`?invoiced=marked`).
 */
export type MarkInvoicedState =
  | null
  | { ok: true; success: string; problems: string[] }
  | { ok: false; kind: "nothing"; problems: string[]; reload: boolean }
  | { ok: false; kind: "error"; message: string };

/** Result of `unmarkInvoiced` when it did not work; success redirects (`?invoiced=unmarked`). */
export type UnmarkInvoicedState = null | { ok: false; message: string; reload: boolean };

const TASKS_PATH = "/tasks";

/** Only the kind of error (and the Postgres code): the message of an error can hold data. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return `${error instanceof Error ? error.name : "error"} ${String((error as { code: unknown }).code)}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

function problemsOf(outcome: Extract<MarkInvoicedOutcome, { kind: "done" }>): string[] {
  const problems: string[] = [];
  if (outcome.alreadyInvoiced.length > 0) {
    problems.push(INVOICE_MESSAGES.alreadyInvoiced(outcome.alreadyInvoiced.length));
  }
  if (outcome.changed.length > 0) {
    problems.push(INVOICE_MESSAGES.changed(outcome.changed.length));
  }
  return problems;
}

/**
 * Marks the selected Afgewerkt tasks as invoiced (design B1 and B3; BT-17). Order of the steps:
 * 1. `requireRole("backoffice")` first;
 * 2. Zod validation: only task numbers (at most one page) with their versions, and where the
 *    request comes from; a form that is not valid is answered like a task that changed;
 * 3. one transaction (`markInvoicedInTransaction`): lock, `checkTransition`, version, update;
 * 4. the overview is refreshed whenever the database answered, also when nothing was marked: the
 *    versions on the page are out of date then. The page of one task is not refreshed after a
 *    refusal, because that would remove the dialog that shows the message;
 * 5. from the page of one task a success redirects to it with the confirmation.
 */
export async function markInvoiced(
  _previous: MarkInvoicedState,
  formData: FormData,
): Promise<MarkInvoicedState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, kind: "error", message: authFailureMessage(error) };
    }
    throw error;
  }

  const parsed = parseMarkInvoicedForm(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "nothing",
      problems: [TASK_ACTION_MESSAGES.changed],
      reload: true,
    };
  }
  const { view } = parsed.data;

  let outcome: MarkInvoicedOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      markInvoicedInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        tasks: parsed.data.tasks,
      }),
    );
  } catch (error) {
    console.error("Marking tasks as invoiced failed:", describeError(error));
    return { ok: false, kind: "error", message: LOGIN_MESSAGES.technicalProblem };
  }

  if (outcome.kind === "refused") {
    // A signed-in, active backoffice user is not refused: not expected.
    return { ok: false, kind: "error", message: LOGIN_MESSAGES.technicalProblem };
  }

  if (view === "task") {
    const [only] = parsed.data.tasks;
    if (outcome.marked.length === 1) {
      revalidatePath(TASKS_PATH);
      revalidatePath(`${TASKS_PATH}/${only.number}`);
      // `redirect()` throws, so it stays outside the try/catch above.
      redirect(`${TASKS_PATH}/${only.number}?invoiced=marked`);
    }
    // No refresh of the task page on a refusal: it would remove the dialog with the message
    // (the button "Pagina herladen" reads the page again).
    return {
      ok: false,
      kind: "nothing",
      problems: [
        outcome.alreadyInvoiced.length > 0
          ? INVOICE_MESSAGES.taskAlreadyInvoiced
          : TASK_ACTION_MESSAGES.changed,
      ],
      reload: true,
    };
  }

  revalidatePath(TASKS_PATH);
  for (const ref of parsed.data.tasks) {
    revalidatePath(`${TASKS_PATH}/${ref.number}`);
  }
  const problems = problemsOf(outcome);
  if (outcome.marked.length === 0) {
    return { ok: false, kind: "nothing", problems, reload: false };
  }
  return { ok: true, success: INVOICE_MESSAGES.marked(outcome.marked.length), problems };
}

/**
 * Takes the "Gefactureerd" mark off one task (design B3; BT-17): `requireRole("backoffice")`,
 * Zod (task number and version), one transaction, then back to the task page with the
 * confirmation. A task that is not Gefactureerd any more, or changed, gives "intussen gewijzigd".
 */
export async function unmarkInvoiced(
  _previous: UnmarkInvoicedState,
  formData: FormData,
): Promise<UnmarkInvoicedState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: authFailureMessage(error), reload: false };
    }
    throw error;
  }

  const parsed = parseUnmarkInvoicedForm(formData);
  if (!parsed.ok) {
    return { ok: false, message: TASK_ACTION_MESSAGES.changed, reload: true };
  }
  const { number, version } = parsed.data;

  let outcome: UnmarkInvoicedOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      unmarkInvoicedInTransaction(tx, {
        actor: { id: actor.id, role: actor.role, isActive: true },
        number,
        version,
      }),
    );
  } catch (error) {
    console.error("Unmarking a task as invoiced failed:", describeError(error));
    return { ok: false, message: LOGIN_MESSAGES.technicalProblem, reload: false };
  }

  switch (outcome.kind) {
    case "unmarked":
      break;
    case "not-found":
      return { ok: false, message: TASK_ACTION_MESSAGES.taskNotFound, reload: false };
    case "changed":
      // No refresh of the task page: it would remove the dialog with this message.
      return { ok: false, message: TASK_ACTION_MESSAGES.changed, reload: true };
    case "refused":
      return { ok: false, message: LOGIN_MESSAGES.technicalProblem, reload: false };
  }

  revalidatePath(TASKS_PATH);
  revalidatePath(`${TASKS_PATH}/${number}`);
  redirect(`${TASKS_PATH}/${number}?invoiced=unmarked`);
}
