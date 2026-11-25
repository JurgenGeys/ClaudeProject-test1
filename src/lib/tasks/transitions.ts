import type { UserRole } from "@/lib/auth/roles";
import { isValidWorkedMinutes } from "@/lib/time/format";

import type { TaskStatus } from "./types";

/**
 * The rules of the status transitions (design chapter 4), as pure functions: no database, no
 * session. A Server Action collects the facts (who is acting, the task, the chosen technician),
 * asks `checkTransition` whether the transition is allowed and only then does the conditional
 * update in the database (`UPDATE ... WHERE id = $1 AND status = $2`).
 *
 * Everything that is not in `TRANSITIONS` is refused, including everything from `cancelled`.
 * The maximum of hours is not decided here but in the Zod schemas.
 */

/** Where a task starts: a new task has no status yet. */
export type TransitionFrom = TaskStatus | "new";

/**
 * Name of the Server Action that carries out the transition (design chapter 4 and 6). Assigning
 * a technician is part of `createTask` and `updateTask`: there is no separate action for it.
 */
export const transitionActions = [
  "createTask",
  "updateTask",
  "pickUpTask",
  "resetTask",
  "completeTask",
  "correctHours",
  "markInvoiced",
  "unmarkInvoiced",
  "cancelTask",
] as const;
export type TransitionAction = (typeof transitionActions)[number];

export interface Transition {
  from: TransitionFrom;
  to: TaskStatus;
  role: UserRole;
  action: TransitionAction;
}

/**
 * All allowed transitions of design chapter 4, in the order of the table there. A transition
 * from a status to the same status is an edit that keeps the status: `updateTask` on an Open,
 * Toegewezen (same or another technician) or Opgepikt task (design B2), and `correctHours`.
 * Each is only valid together with its own action: `picked_up -> assigned` is Terugzetten
 * (`resetTask`) and never a normal edit.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: "new", to: "open", role: "backoffice", action: "createTask" },
  { from: "new", to: "assigned", role: "backoffice", action: "createTask" },
  { from: "open", to: "open", role: "backoffice", action: "updateTask" },
  { from: "open", to: "assigned", role: "backoffice", action: "updateTask" },
  { from: "assigned", to: "assigned", role: "backoffice", action: "updateTask" },
  { from: "assigned", to: "open", role: "backoffice", action: "updateTask" },
  { from: "picked_up", to: "picked_up", role: "backoffice", action: "updateTask" },
  { from: "assigned", to: "picked_up", role: "technician", action: "pickUpTask" },
  { from: "picked_up", to: "assigned", role: "backoffice", action: "resetTask" },
  { from: "picked_up", to: "completed", role: "technician", action: "completeTask" },
  { from: "completed", to: "completed", role: "backoffice", action: "correctHours" },
  { from: "completed", to: "invoiced", role: "backoffice", action: "markInvoiced" },
  { from: "invoiced", to: "completed", role: "backoffice", action: "unmarkInvoiced" },
  { from: "open", to: "cancelled", role: "backoffice", action: "cancelTask" },
  { from: "assigned", to: "cancelled", role: "backoffice", action: "cancelTask" },
];

/**
 * A user as the rules see it: the actor of a transition, or the technician a task is given to.
 * `isActive` comes from the profile: a deactivated user can do nothing and gets no tasks.
 */
export interface TaskUser {
  id: string;
  role: UserRole;
  isActive: boolean;
}

export interface TransitionRequest {
  from: TransitionFrom;
  to: TaskStatus;
  /** The Server Action that asks for the transition; it must be the one that belongs to it. */
  action: TransitionAction;
  actor: TaskUser;
  /** The assignee the task has now (`assignee_id`); `null` or absent for a new or open task. */
  currentAssigneeId?: string | null;
  /**
   * The assignee after the transition; `null` or absent means "Nog niet toewijzen". Only when
   * editing an Opgepikt task, absent means "unchanged" (the select is disabled in B2).
   */
  newAssignee?: TaskUser | null;
  /** `completeTask`: the hours of the technician. */
  workedMinutes?: number;
  /** `correctHours`: the new hours and the reason. */
  correctedMinutes?: number;
  correctionReason?: string;
}

/** Why a transition is refused. Server Actions map these to the messages of design chapter 3. */
export type TransitionDenial =
  /** This combination of statuses does not exist (including everything from Geannuleerd). */
  | "transition_not_allowed"
  /** The transition exists, but not for this action (e.g. Terugzetten through a normal edit). */
  | "wrong_action"
  | "wrong_role"
  | "actor_inactive"
  /** A technician acts on a task that is not (or no longer) assigned to him. */
  | "not_assignee"
  /** The transition needs a technician and none was given. */
  | "assignee_required"
  /** The transition must leave the task without a technician but one was given. */
  | "assignee_not_allowed"
  /** The chosen user is not a technician. */
  | "assignee_not_technician"
  /** The chosen technician is deactivated. */
  | "assignee_inactive"
  /** The technician of a picked up task cannot be changed by a normal edit: use Terugzetten. */
  | "assignee_locked"
  | "hours_invalid"
  | "reason_required";

export type TransitionDecision = { allowed: true } | { allowed: false; reason: TransitionDenial };

const ALLOWED: TransitionDecision = { allowed: true };

function denied(reason: TransitionDenial): TransitionDecision {
  return { allowed: false, reason };
}

/** The listed transition for this pair of statuses and this action, if there is one. */
export function findTransition(
  from: TransitionFrom,
  to: TaskStatus,
  action: TransitionAction,
): Transition | undefined {
  return TRANSITIONS.find(
    (transition) =>
      transition.from === from && transition.to === to && transition.action === action,
  );
}

/** Does any action lead from this status to that one? */
function hasPair(from: TransitionFrom, to: TaskStatus): boolean {
  return TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

/** A technician must be given: active and with the role technician. */
function checkNewAssignee(assignee: TaskUser | null | undefined): TransitionDenial | null {
  if (!assignee) {
    return "assignee_required";
  }
  if (assignee.role !== "technician") {
    return "assignee_not_technician";
  }
  if (!assignee.isActive) {
    return "assignee_inactive";
  }
  return null;
}

/** A technician acts on his own task: the task is assigned to him. */
function isOwnTask(request: TransitionRequest): boolean {
  return request.currentAssigneeId != null && request.currentAssigneeId === request.actor.id;
}

/**
 * Decides whether a transition may happen. Checks, in this order: does the transition exist
 * and does it belong to the requested action, is the actor active and of the right role, and then the conditions of that transition.
 * Roles are never mixed up: the back office cannot pick up or complete on behalf of a
 * technician (open question V10 of the analysis).
 */
export function checkTransition(request: TransitionRequest): TransitionDecision {
  const transition = findTransition(request.from, request.to, request.action);
  if (!transition) {
    return denied(hasPair(request.from, request.to) ? "wrong_action" : "transition_not_allowed");
  }
  if (!request.actor.isActive) {
    return denied("actor_inactive");
  }
  if (request.actor.role !== transition.role) {
    return denied("wrong_role");
  }

  switch (transition.action) {
    case "createTask": {
      // `new -> open` has no technician, `new -> assigned` has an active one.
      return request.to === "open" ? checkNoAssignee(request) : checkAssignee(request);
    }

    case "updateTask": {
      if (request.to === "open") {
        // Open stays Open, or "Nog niet toewijzen" (P2).
        return checkNoAssignee(request);
      }
      if (request.from === "picked_up") {
        // Editing a picked up task: the technician stays (use Terugzetten to change him).
        // Absent means "unchanged"; `null` would clear him, which is refused.
        return request.newAssignee === undefined ||
          request.newAssignee?.id === request.currentAssigneeId
          ? ALLOWED
          : denied("assignee_locked");
      }
      // Open to Toegewezen, or Toegewezen with the same or another technician.
      return checkAssignee(request);
    }

    case "pickUpTask":
      // Other picked up tasks do not matter (K5).
      return isOwnTask(request) ? ALLOWED : denied("not_assignee");

    case "resetTask":
      // Another technician or date is allowed, and so is the same technician.
      return checkAssignee(request);

    case "completeTask": {
      if (!isOwnTask(request)) {
        return denied("not_assignee");
      }
      const minutes = request.workedMinutes;
      return minutes !== undefined && isValidWorkedMinutes(minutes)
        ? ALLOWED
        : denied("hours_invalid");
    }

    case "correctHours": {
      const minutes = request.correctedMinutes;
      if (minutes === undefined || !isValidWorkedMinutes(minutes)) {
        return denied("hours_invalid");
      }
      return request.correctionReason?.trim() ? ALLOWED : denied("reason_required");
    }

    case "markInvoiced":
    case "unmarkInvoiced":
    case "cancelTask":
      // Cancelling keeps the assignee for the history, so there is nothing to check on it.
      return ALLOWED;
  }
}

function checkAssignee(request: TransitionRequest): TransitionDecision {
  const problem = checkNewAssignee(request.newAssignee);
  return problem ? denied(problem) : ALLOWED;
}

function checkNoAssignee(request: TransitionRequest): TransitionDecision {
  return request.newAssignee ? denied("assignee_not_allowed") : ALLOWED;
}

/** Convenience for places that only need a yes or no, such as showing a button. */
export function canTransition(request: TransitionRequest): boolean {
  return checkTransition(request).allowed;
}

/** The transitions a role can start from a status (for the actions of design screen B3). */
export function transitionsFrom(from: TransitionFrom, role: UserRole): Transition[] {
  return TRANSITIONS.filter((transition) => transition.from === from && transition.role === role);
}

/** Open, Toegewezen and Opgepikt can be edited (design B2); the rest is read only. */
export function canEditTask(status: TaskStatus): boolean {
  return status === "open" || status === "assigned" || status === "picked_up";
}

/** The technician can no longer be changed through the edit form once the task is picked up. */
export function canChangeAssigneeInEditForm(status: TaskStatus): boolean {
  return status === "open" || status === "assigned";
}

/** Geannuleerd has no way out. */
export function isFinalStatus(status: TaskStatus): boolean {
  return status === "cancelled";
}
