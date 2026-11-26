import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { profiles } from "@/db/schema";

import type { TaskUser, TransitionDenial } from "./transitions";

/** The technician a task is given to, as read under a lock. */
export type LockedAssignee = { user: TaskUser; fullName: string; invitePending: boolean };

/** Why a technician cannot be given a task. Shared by `createTask` and `updateTask`. */
export type AssigneeProblem =
  /** No profile with this id, or it is not a technician. */
  | { kind: "assignee-not-found" }
  | { kind: "assignee-inactive"; fullName: string }
  /** Invited, no password chosen yet: he cannot sign in, so he would never see the task. */
  | { kind: "assignee-invited"; fullName: string }
  /** The transition rules refused for another reason (for example the actor). */
  | { kind: "refused"; reason: TransitionDenial };

/**
 * Reads the technician's profile with `FOR SHARE` (the rule of BT-07): switching a technician
 * off takes `FOR UPDATE` on this row, so either the switch-off commits first and this
 * transaction sees `is_active = false`, or this transaction commits first and the switch-off
 * counts the task and is refused. Two saves for the same technician do not block each other.
 * Must run inside the transaction that saves the task.
 */
export async function lockAssignee(
  tx: Pick<Database, "select">,
  assigneeId: string,
): Promise<LockedAssignee | null> {
  const [profile] = await tx
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      isActive: profiles.isActive,
      invitePending: profiles.invitePending,
    })
    .from(profiles)
    .where(eq(profiles.id, assigneeId))
    .for("share");
  if (!profile) {
    return null;
  }
  return {
    user: { id: profile.id, role: profile.role, isActive: profile.isActive },
    fullName: profile.fullName,
    invitePending: profile.invitePending,
  };
}

/** Turns a refused transition into the problem the form shows (`null` is not expected here). */
export function assigneeProblemOf(reason: TransitionDenial, fullName: string): AssigneeProblem {
  switch (reason) {
    case "assignee_not_technician":
      return { kind: "assignee-not-found" };
    case "assignee_inactive":
      return { kind: "assignee-inactive", fullName };
    default:
      return { kind: "refused", reason };
  }
}
