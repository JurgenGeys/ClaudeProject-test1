import { describe, expect, it } from "vitest";

import type { UserRole } from "@/lib/auth/roles";

import {
  canChangeAssigneeInEditForm,
  canEditTask,
  canTransition,
  checkTransition,
  findTransition,
  isFinalStatus,
  TRANSITIONS,
  transitionActions,
  transitionsFrom,
  type TaskUser,
  type TransitionAction,
  type TransitionFrom,
  type TransitionRequest,
} from "./transitions";
import { taskStatuses, type TaskStatus } from "./types";

const KEVIN = "11111111-1111-4111-8111-111111111111";
const BRAM = "22222222-2222-4222-8222-222222222222";
const SOFIE = "33333333-3333-4333-8333-333333333333";

const roles: UserRole[] = ["backoffice", "technician"];
const origins: TransitionFrom[] = ["new", ...taskStatuses];

const backoffice: TaskUser = { id: SOFIE, role: "backoffice", isActive: true };
const kevinActor: TaskUser = { id: KEVIN, role: "technician", isActive: true };
const colleagueActor: TaskUser = { id: BRAM, role: "technician", isActive: true };
const kevin: TaskUser = { id: KEVIN, role: "technician", isActive: true };
const bram: TaskUser = { id: BRAM, role: "technician", isActive: true };

type Facts = Omit<TransitionRequest, "from" | "to" | "action" | "actor"> & { actor?: TaskUser };

/** Shorthand for a request. The actor defaults to the back office. */
function ask(
  action: TransitionAction,
  from: TransitionFrom,
  to: TaskStatus,
  facts: Facts = {},
): TransitionRequest {
  return { from, to, action, actor: backoffice, ...facts };
}

/** A request that satisfies every condition of the transition, for the role that may do it. */
function validRequest(from: TransitionFrom, to: TaskStatus, action: TransitionAction) {
  const transition = findTransition(from, to, action);
  if (!transition) {
    throw new Error(`No transition ${from} -> ${to} for ${action}`);
  }
  const actor = transition.role === "backoffice" ? backoffice : kevinActor;
  const base = { from, to, action, actor };
  switch (action) {
    case "createTask":
      return to === "assigned" ? { ...base, newAssignee: kevin } : base;
    case "updateTask":
      if (from === "open" && to === "open") {
        return { ...base, currentAssigneeId: null };
      }
      if (to === "open") {
        return { ...base, currentAssigneeId: KEVIN };
      }
      if (from === "open") {
        return { ...base, currentAssigneeId: null, newAssignee: kevin };
      }
      if (from === "picked_up") {
        return { ...base, currentAssigneeId: KEVIN };
      }
      return { ...base, currentAssigneeId: KEVIN, newAssignee: bram };
    case "pickUpTask":
      return { ...base, currentAssigneeId: KEVIN };
    case "resetTask":
      return { ...base, currentAssigneeId: KEVIN, newAssignee: kevin };
    case "completeTask":
      return { ...base, currentAssigneeId: KEVIN, workedMinutes: 90 };
    case "correctHours":
      return { ...base, currentAssigneeId: KEVIN, correctedMinutes: 90, correctionReason: "Pauze" };
    default:
      return { ...base, currentAssigneeId: KEVIN };
  }
}

describe("TRANSITIONS", () => {
  it("lists the transitions of design chapter 4 and the edits that keep the status", () => {
    expect(TRANSITIONS.map((t) => `${t.from} -> ${t.to} (${t.role}, ${t.action})`)).toEqual([
      "new -> open (backoffice, createTask)",
      "new -> assigned (backoffice, createTask)",
      "open -> open (backoffice, updateTask)",
      "open -> assigned (backoffice, updateTask)",
      "assigned -> assigned (backoffice, updateTask)",
      "assigned -> open (backoffice, updateTask)",
      "picked_up -> picked_up (backoffice, updateTask)",
      "assigned -> picked_up (technician, pickUpTask)",
      "picked_up -> assigned (backoffice, resetTask)",
      "picked_up -> completed (technician, completeTask)",
      "completed -> completed (backoffice, correctHours)",
      "completed -> invoiced (backoffice, markInvoiced)",
      "invoiced -> completed (backoffice, unmarkInvoiced)",
      "open -> cancelled (backoffice, cancelTask)",
      "assigned -> cancelled (backoffice, cancelTask)",
    ]);
  });

  it("has no two entries for the same status pair and action", () => {
    const keys = TRANSITIONS.map((t) => `${t.from}>${t.to}>${t.action}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses the action names of design chapter 6", () => {
    expect([...transitionActions].sort()).toEqual(
      [
        "cancelTask",
        "completeTask",
        "correctHours",
        "createTask",
        "markInvoiced",
        "pickUpTask",
        "resetTask",
        "unmarkInvoiced",
        "updateTask",
      ].sort(),
    );
  });
});

describe("matrix: every combination of from, to, action and role", () => {
  let allowedCount = 0;
  let total = 0;

  for (const from of origins) {
    for (const to of taskStatuses) {
      for (const action of transitionActions) {
        for (const role of roles) {
          total += 1;
          const transition = findTransition(from, to, action);
          const pairExists = TRANSITIONS.some((t) => t.from === from && t.to === to);
          const name = `${from} -> ${to} by ${action} as ${role}`;
          // Everything a transition could ask for, so only the combination decides.
          const actor = role === "backoffice" ? backoffice : kevinActor;

          if (transition?.role === role) {
            allowedCount += 1;
            it(`${name}: allowed`, () => {
              expect(checkTransition(validRequest(from, to, action))).toEqual({ allowed: true });
            });
          } else if (transition) {
            it(`${name}: refused, wrong role`, () => {
              expect(
                checkTransition({ ...validRequest(from, to, action), actor: { ...actor } }),
              ).toEqual({ allowed: false, reason: "wrong_role" });
            });
          } else {
            const reason = pairExists ? "wrong_action" : "transition_not_allowed";
            it(`${name}: refused, ${reason}`, () => {
              expect(
                checkTransition({
                  from,
                  to,
                  action,
                  actor,
                  currentAssigneeId: actor.id,
                  newAssignee: kevin,
                  workedMinutes: 90,
                  correctedMinutes: 90,
                  correctionReason: "Pauze",
                }),
              ).toEqual({ allowed: false, reason });
            });
          }
        }
      }
    }
  }

  it("covers 7 origins x 6 targets x 9 actions x 2 roles = 756 combinations, 15 allowed", () => {
    expect([total, allowedCount]).toEqual([756, 15]);
  });

  it("never lets a task leave Geannuleerd", () => {
    for (const to of taskStatuses) {
      for (const action of transitionActions) {
        expect(findTransition("cancelled", to, action)).toBeUndefined();
      }
    }
    expect(isFinalStatus("cancelled")).toBe(true);
    for (const status of taskStatuses.filter((s) => s !== "cancelled")) {
      expect(isFinalStatus(status)).toBe(false);
    }
  });

  it("only cancels from Open and Toegewezen, so a cancelled task never has hours", () => {
    for (const from of origins) {
      expect(findTransition(from, "cancelled", "cancelTask") !== undefined).toBe(
        from === "open" || from === "assigned",
      );
    }
  });
});

describe("the right transition with the wrong action", () => {
  it("refuses Terugzetten through a normal edit (B2 does not allow it)", () => {
    expect(
      checkTransition(
        ask("updateTask", "picked_up", "assigned", {
          currentAssigneeId: KEVIN,
          newAssignee: kevin,
        }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_action" });
  });

  it("refuses to cancel through an edit and to edit through cancelTask", () => {
    expect(checkTransition(ask("updateTask", "open", "cancelled"))).toEqual({
      allowed: false,
      reason: "wrong_action",
    });
    expect(checkTransition(ask("cancelTask", "open", "open"))).toEqual({
      allowed: false,
      reason: "wrong_action",
    });
  });

  it("refuses Open to Toegewezen through resetTask or cancelTask", () => {
    for (const action of ["resetTask", "cancelTask", "pickUpTask"] as const) {
      expect(checkTransition(ask(action, "open", "assigned", { newAssignee: kevin }))).toEqual({
        allowed: false,
        reason: "wrong_action",
      });
    }
  });

  it("refuses invoicing through correctHours and correcting through markInvoiced", () => {
    expect(
      checkTransition(
        ask("correctHours", "completed", "invoiced", {
          correctedMinutes: 90,
          correctionReason: "Pauze",
        }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_action" });
    expect(checkTransition(ask("markInvoiced", "completed", "completed"))).toEqual({
      allowed: false,
      reason: "wrong_action",
    });
  });

  it("refuses completing through pickUpTask and picking up through completeTask", () => {
    expect(
      checkTransition(
        ask("pickUpTask", "picked_up", "completed", {
          actor: kevinActor,
          currentAssigneeId: KEVIN,
          workedMinutes: 60,
        }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_action" });
    expect(
      checkTransition(
        ask("completeTask", "assigned", "picked_up", {
          actor: kevinActor,
          currentAssigneeId: KEVIN,
        }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_action" });
  });

  it("checks the action before the role: a wrong action is never 'allowed for someone'", () => {
    expect(
      checkTransition(
        ask("createTask", "picked_up", "assigned", { actor: kevinActor, currentAssigneeId: KEVIN }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_action" });
  });
});

describe("an inactive actor", () => {
  it("can do nothing, whatever the role", () => {
    for (const transition of TRANSITIONS) {
      const request = validRequest(transition.from, transition.to, transition.action);
      expect(checkTransition({ ...request, actor: { ...request.actor, isActive: false } })).toEqual(
        { allowed: false, reason: "actor_inactive" },
      );
    }
  });
});

describe("creating a task (createTask)", () => {
  it("is Open without a technician", () => {
    expect(canTransition(ask("createTask", "new", "open"))).toBe(true);
    expect(canTransition(ask("createTask", "new", "open", { newAssignee: null }))).toBe(true);
  });

  it("refuses Open with a technician", () => {
    expect(checkTransition(ask("createTask", "new", "open", { newAssignee: kevin }))).toEqual({
      allowed: false,
      reason: "assignee_not_allowed",
    });
  });

  it("is Toegewezen with an active technician", () => {
    expect(canTransition(ask("createTask", "new", "assigned", { newAssignee: kevin }))).toBe(true);
  });

  it("refuses Toegewezen without, with a deactivated or with a non-technician assignee", () => {
    expect(checkTransition(ask("createTask", "new", "assigned"))).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
    expect(checkTransition(ask("createTask", "new", "assigned", { newAssignee: null }))).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
    expect(
      checkTransition(
        ask("createTask", "new", "assigned", { newAssignee: { ...kevin, isActive: false } }),
      ),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
    expect(
      checkTransition(
        ask("createTask", "new", "assigned", { newAssignee: { ...kevin, role: "backoffice" } }),
      ),
    ).toEqual({ allowed: false, reason: "assignee_not_technician" });
  });
});

describe("editing, assigning and unassigning (updateTask)", () => {
  it("Open stays Open without a technician", () => {
    expect(canTransition(ask("updateTask", "open", "open"))).toBe(true);
    expect(canTransition(ask("updateTask", "open", "open", { newAssignee: null }))).toBe(true);
    // A technician makes it Toegewezen, which is another transition.
    expect(checkTransition(ask("updateTask", "open", "open", { newAssignee: kevin }))).toEqual({
      allowed: false,
      reason: "assignee_not_allowed",
    });
  });

  it("Open to Toegewezen needs an active technician", () => {
    expect(canTransition(ask("updateTask", "open", "assigned", { newAssignee: kevin }))).toBe(true);
    expect(checkTransition(ask("updateTask", "open", "assigned"))).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
    expect(
      checkTransition(
        ask("updateTask", "open", "assigned", { newAssignee: { ...kevin, isActive: false } }),
      ),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
  });

  it("Toegewezen can be edited with the same technician (only the date, say)", () => {
    expect(
      checkTransition(
        ask("updateTask", "assigned", "assigned", { currentAssigneeId: KEVIN, newAssignee: kevin }),
      ),
    ).toEqual({ allowed: true });
  });

  it("Toegewezen can be given to another active technician", () => {
    const facts = { currentAssigneeId: KEVIN };
    expect(
      canTransition(ask("updateTask", "assigned", "assigned", { ...facts, newAssignee: bram })),
    ).toBe(true);
    expect(
      checkTransition(
        ask("updateTask", "assigned", "assigned", {
          ...facts,
          newAssignee: { ...bram, isActive: false },
        }),
      ),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
    expect(checkTransition(ask("updateTask", "assigned", "assigned", facts))).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
  });

  it("Toegewezen with the same technician is refused when he has been deactivated", () => {
    expect(
      checkTransition(
        ask("updateTask", "assigned", "assigned", {
          currentAssigneeId: KEVIN,
          newAssignee: { ...kevin, isActive: false },
        }),
      ),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
  });

  it("Toegewezen to Open (Nog niet toewijzen) clears the technician", () => {
    const facts = { currentAssigneeId: KEVIN };
    expect(canTransition(ask("updateTask", "assigned", "open", facts))).toBe(true);
    expect(
      canTransition(ask("updateTask", "assigned", "open", { ...facts, newAssignee: null })),
    ).toBe(true);
    expect(
      checkTransition(ask("updateTask", "assigned", "open", { ...facts, newAssignee: bram })),
    ).toEqual({ allowed: false, reason: "assignee_not_allowed" });
  });

  it("Opgepikt can be edited, but the technician stays", () => {
    const facts = { currentAssigneeId: KEVIN };
    expect(canTransition(ask("updateTask", "picked_up", "picked_up", facts))).toBe(true);
    expect(
      canTransition(ask("updateTask", "picked_up", "picked_up", { ...facts, newAssignee: kevin })),
    ).toBe(true);
    expect(
      checkTransition(ask("updateTask", "picked_up", "picked_up", { ...facts, newAssignee: bram })),
    ).toEqual({ allowed: false, reason: "assignee_locked" });
    expect(
      checkTransition(ask("updateTask", "picked_up", "picked_up", { ...facts, newAssignee: null })),
    ).toEqual({ allowed: false, reason: "assignee_locked" });
  });

  it("is refused for a technician", () => {
    expect(
      checkTransition(
        ask("updateTask", "open", "assigned", { actor: kevinActor, newAssignee: kevin }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_role" });
  });

  it("is not possible on Afgewerkt, Gefactureerd and Geannuleerd", () => {
    for (const status of ["completed", "invoiced", "cancelled"] as const) {
      expect(
        checkTransition(ask("updateTask", status, status, { currentAssigneeId: KEVIN })),
      ).toMatchObject({ allowed: false });
    }
  });
});

describe("picking up (pickUpTask)", () => {
  const pick = (facts: Facts) => ask("pickUpTask", "assigned", "picked_up", facts);

  it("is allowed for the assigned technician, also when he has other picked up tasks (K5)", () => {
    expect(canTransition(pick({ actor: kevinActor, currentAssigneeId: KEVIN }))).toBe(true);
  });

  it("is refused for a colleague", () => {
    expect(checkTransition(pick({ actor: colleagueActor, currentAssigneeId: KEVIN }))).toEqual({
      allowed: false,
      reason: "not_assignee",
    });
  });

  it("is refused when the task has no technician", () => {
    expect(checkTransition(pick({ actor: kevinActor, currentAssigneeId: null }))).toEqual({
      allowed: false,
      reason: "not_assignee",
    });
    expect(checkTransition(pick({ actor: kevinActor }))).toEqual({
      allowed: false,
      reason: "not_assignee",
    });
  });

  it("is refused for the back office, which cannot pick up for a technician", () => {
    expect(checkTransition(pick({ currentAssigneeId: KEVIN }))).toEqual({
      allowed: false,
      reason: "wrong_role",
    });
  });
});

describe("resetting (resetTask)", () => {
  const reset = (facts: Facts) => ask("resetTask", "picked_up", "assigned", facts);

  it("is allowed with the same or another active technician", () => {
    expect(canTransition(reset({ currentAssigneeId: KEVIN, newAssignee: kevin }))).toBe(true);
    expect(canTransition(reset({ currentAssigneeId: KEVIN, newAssignee: bram }))).toBe(true);
  });

  it("needs an active technician", () => {
    expect(checkTransition(reset({ currentAssigneeId: KEVIN }))).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
    expect(
      checkTransition(
        reset({ currentAssigneeId: KEVIN, newAssignee: { ...kevin, isActive: false } }),
      ),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
  });
});

describe("completing (completeTask)", () => {
  const complete = (facts: Facts) => ask("completeTask", "picked_up", "completed", facts);
  const own = { actor: kevinActor, currentAssigneeId: KEVIN };

  it("is allowed for the own task with hours per quarter", () => {
    for (const workedMinutes of [15, 30, 90, 960]) {
      expect(canTransition(complete({ ...own, workedMinutes }))).toBe(true);
    }
  });

  it("does not know a maximum: that is in the Zod schema", () => {
    expect(canTransition(complete({ ...own, workedMinutes: 99 * 60 }))).toBe(true);
  });

  it("refuses 0, negative, no quarter, fractions and no hours", () => {
    for (const workedMinutes of [0, -15, 10, 100, 22.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkTransition(complete({ ...own, workedMinutes }))).toEqual({
        allowed: false,
        reason: "hours_invalid",
      });
    }
    expect(checkTransition(complete(own))).toEqual({ allowed: false, reason: "hours_invalid" });
  });

  it("is refused for a colleague", () => {
    expect(
      checkTransition(
        complete({ actor: colleagueActor, currentAssigneeId: KEVIN, workedMinutes: 60 }),
      ),
    ).toEqual({ allowed: false, reason: "not_assignee" });
  });

  it("is refused for the back office (V10: no completing on behalf of a technician)", () => {
    expect(checkTransition(complete({ workedMinutes: 60 }))).toEqual({
      allowed: false,
      reason: "wrong_role",
    });
  });
});

describe("correcting hours (correctHours)", () => {
  const correct = (facts: Facts) => ask("correctHours", "completed", "completed", facts);

  it("needs valid hours and a reason", () => {
    expect(canTransition(correct({ correctedMinutes: 90, correctionReason: "Pauze" }))).toBe(true);
  });

  it("refuses invalid hours", () => {
    for (const correctedMinutes of [0, -15, 20, 7.5]) {
      expect(checkTransition(correct({ correctedMinutes, correctionReason: "Pauze" }))).toEqual({
        allowed: false,
        reason: "hours_invalid",
      });
    }
    expect(checkTransition(correct({ correctionReason: "Pauze" }))).toEqual({
      allowed: false,
      reason: "hours_invalid",
    });
  });

  it("refuses a missing, empty or blank reason", () => {
    for (const correctionReason of [undefined, "", "   ", "\n\t"]) {
      expect(checkTransition(correct({ correctedMinutes: 90, correctionReason }))).toEqual({
        allowed: false,
        reason: "reason_required",
      });
    }
  });

  it("is refused for a technician", () => {
    expect(
      checkTransition(
        correct({ actor: kevinActor, correctedMinutes: 90, correctionReason: "Pauze" }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_role" });
  });

  it("exists only from Afgewerkt to Afgewerkt: on Gefactureerd the mark must be undone first", () => {
    const corrections = TRANSITIONS.filter((t) => t.action === "correctHours");
    expect(corrections.map((t) => `${t.from} -> ${t.to}`)).toEqual(["completed -> completed"]);
    expect(
      checkTransition(
        ask("correctHours", "invoiced", "invoiced", {
          correctedMinutes: 90,
          correctionReason: "Pauze",
        }),
      ),
    ).toEqual({ allowed: false, reason: "transition_not_allowed" });
    // The pair invoiced -> completed exists, but belongs to unmarkInvoiced.
    expect(
      checkTransition(
        ask("correctHours", "invoiced", "completed", {
          correctedMinutes: 90,
          correctionReason: "Pauze",
        }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_action" });
  });
});

describe("invoicing (markInvoiced, unmarkInvoiced)", () => {
  it("marks Afgewerkt as Gefactureerd and back, for the back office only", () => {
    expect(canTransition(ask("markInvoiced", "completed", "invoiced"))).toBe(true);
    expect(canTransition(ask("unmarkInvoiced", "invoiced", "completed"))).toBe(true);
    expect(canTransition(ask("markInvoiced", "completed", "invoiced", { actor: kevinActor }))).toBe(
      false,
    );
    expect(
      canTransition(ask("unmarkInvoiced", "invoiced", "completed", { actor: kevinActor })),
    ).toBe(false);
  });
});

describe("cancelling (cancelTask)", () => {
  it("is allowed from Open and Toegewezen, with or without a reason", () => {
    for (const from of ["open", "assigned"] as const) {
      expect(canTransition(ask("cancelTask", from, "cancelled"))).toBe(true);
    }
  });

  it("is refused from Opgepikt (reset first), Afgewerkt, Gefactureerd and Geannuleerd", () => {
    for (const from of ["picked_up", "completed", "invoiced", "cancelled"] as const) {
      expect(checkTransition(ask("cancelTask", from, "cancelled"))).toEqual({
        allowed: false,
        reason: "transition_not_allowed",
      });
    }
  });

  it("is refused for a technician, also for his own task", () => {
    expect(
      checkTransition(
        ask("cancelTask", "assigned", "cancelled", { actor: kevinActor, currentAssigneeId: KEVIN }),
      ),
    ).toEqual({ allowed: false, reason: "wrong_role" });
  });
});

describe("transitionsFrom", () => {
  it("lists what a role can start from a status (the actions of screen B3)", () => {
    const actions = (from: TransitionFrom, role: UserRole) =>
      transitionsFrom(from, role).map((t) => t.action);

    expect(actions("open", "backoffice")).toEqual(["updateTask", "updateTask", "cancelTask"]);
    expect(actions("assigned", "backoffice")).toEqual(["updateTask", "updateTask", "cancelTask"]);
    expect(actions("picked_up", "backoffice")).toEqual(["updateTask", "resetTask"]);
    expect(actions("completed", "backoffice")).toEqual(["correctHours", "markInvoiced"]);
    expect(actions("invoiced", "backoffice")).toEqual(["unmarkInvoiced"]);
    expect(actions("cancelled", "backoffice")).toEqual([]);
    expect(actions("assigned", "technician")).toEqual(["pickUpTask"]);
    expect(actions("picked_up", "technician")).toEqual(["completeTask"]);
    expect(actions("open", "technician")).toEqual([]);
    expect(actions("completed", "technician")).toEqual([]);
  });
});

describe("editing", () => {
  it("is possible for Open, Toegewezen and Opgepikt only, and matches the updateTask transitions", () => {
    const editable = taskStatuses.filter((status) => canEditTask(status));
    expect(editable).toEqual(["open", "assigned", "picked_up"]);
    for (const status of taskStatuses) {
      expect(findTransition(status, status, "updateTask") !== undefined).toBe(canEditTask(status));
    }
  });

  it("can change the technician in the form for Open and Toegewezen only", () => {
    const changeable = taskStatuses.filter((status) => canChangeAssigneeInEditForm(status));
    expect(changeable).toEqual(["open", "assigned"]);
  });
});
