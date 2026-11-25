import { TASK_MESSAGES } from "@/lib/validation/messages";
import type { CreateTaskFieldErrors } from "@/lib/validation/create-task";

import type { AssigneeProblem } from "./assignee";
import { TASK_ACTION_MESSAGES } from "./messages";

/**
 * The message under the field a refusal belongs to (design B2), for the problems that
 * `createTask` and `updateTask` share. `null` for the ones that are no field problem
 * (`refused`, which is not expected for a signed-in backoffice user).
 */
export function fieldErrorsOf(
  outcome: AssigneeProblem | { kind: "customer-not-found" },
): CreateTaskFieldErrors | null {
  switch (outcome.kind) {
    case "customer-not-found":
      return { customerId: TASK_ACTION_MESSAGES.customerNotFound };
    case "assignee-not-found":
      return { assigneeId: TASK_MESSAGES.assigneeInvalid };
    case "assignee-inactive":
      return { assigneeId: TASK_ACTION_MESSAGES.assigneeInactive(outcome.fullName) };
    case "assignee-invited":
      return { assigneeId: TASK_ACTION_MESSAGES.assigneeInvited(outcome.fullName) };
    case "refused":
      return null;
  }
}
