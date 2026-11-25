import { describe, expect, it } from "vitest";

import {
  canChangeAssigneeInEditForm,
  canEditTask,
  canTransition,
  checkTransition,
  findTransition,
  isFinalStatus,
  TRANSITIONS,
  transitionsFrom,
  type Actor,
  type ActorRole,
  type Assignee,
  type TransitionFrom,
  type TransitionRequest,
} from "./transitions";
import { taskStatuses, type TaskStatus } from "./types";

const KEVIN = "11111111-1111-4111-8111-111111111111";
const BRAM = "22222222-2222-4222-8222-222222222222";
const SOFIE = "33333333-3333-4333-8333-333333333333";

const roles: ActorRole[] = ["backoffice", "technician"];
const origins: TransitionFrom[] = ["new", ...taskStatuses];

const backoffice: Actor = { id: SOFIE, role: "backoffice", isActive: true };
const kevinActor: Actor = { id: KEVIN, role: "technician", isActive: true };
const kevin: Assignee = { id: KEVIN, role: "technician", isActive: true };
const bram: Assignee = { id: BRAM, role: "technician", isActive: true };

/** A request that satisfies every condition of the transition, for the role that may do it. */
function validRequest(from: TransitionFrom, to: TaskStatus): TransitionRequest {
  const transition = findTransition(from, to);
  if (!transition) {
    throw new Error(`No transition ${from} -> ${to}`);
  }
  const actor = transition.role === "backoffice" ? backoffice : kevinActor;
  const base: TransitionRequest = { from, to, actor };
  switch (transition.action) {
    case "createTask":
      return to === "assigned" ? { ...base, newAssignee: kevin } : base;
    case "updateTask":
      if (to === "open") {
        return { ...base, currentAssigneeId: KEVIN };
      }
      // Open -> Toegewezen has no technician yet, Toegewezen -> Toegewezen switches to another.
      return from === "open"
        ? { ...base, currentAssigneeId: null, newAssignee: kevin }
        : { ...base, currentAssigneeId: KEVIN, newAssignee: bram };
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
  it("lists the 13 transitions of design chapter 4", () => {
    expect(TRANSITIONS.map((t) => `${t.from} -> ${t.to} (${t.role}, ${t.action})`)).toEqual([
      "new -> open (backoffice, createTask)",
      "new -> assigned (backoffice, createTask)",
      "open -> assigned (backoffice, updateTask)",
      "assigned -> assigned (backoffice, updateTask)",
      "assigned -> open (backoffice, updateTask)",
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

  it("has no two transitions for the same pair of statuses", () => {
    const pairs = TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("transition matrix: every combination of from, to and role", () => {
  for (const from of origins) {
    for (const to of taskStatuses) {
      for (const role of roles) {
        const transition = findTransition(from, to);
        const name = `${from} -> ${to} as ${role}`;

        if (transition?.role === role) {
          it(`${name}: allowed`, () => {
            expect(checkTransition(validRequest(from, to))).toEqual({ allowed: true });
          });
        } else if (transition) {
          it(`${name}: refused, wrong role`, () => {
            const request = validRequest(from, to);
            // Same facts, but acted by the other role (the technician owns the task).
            const actor: Actor = role === "backoffice" ? backoffice : { ...kevinActor, id: KEVIN };
            expect(checkTransition({ ...request, actor })).toEqual({
              allowed: false,
              reason: "wrong_role",
            });
          });
        } else {
          it(`${name}: refused, no such transition`, () => {
            const actor = role === "backoffice" ? backoffice : kevinActor;
            expect(
              checkTransition({
                from,
                to,
                actor,
                currentAssigneeId: KEVIN,
                newAssignee: kevin,
                workedMinutes: 90,
                correctedMinutes: 90,
                correctionReason: "Pauze",
              }),
            ).toEqual({ allowed: false, reason: "transition_not_allowed" });
          });
        }
      }
    }
  }

  it("has 7 origins x 6 targets x 2 roles = 84 combinations, 13 of them allowed", () => {
    let allowed = 0;
    let total = 0;
    for (const from of origins) {
      for (const to of taskStatuses) {
        for (const role of roles) {
          total += 1;
          const transition = findTransition(from, to);
          if (transition?.role === role) {
            allowed += 1;
          }
        }
      }
    }
    expect([total, allowed]).toEqual([84, 13]);
  });

  it("never lets a task leave Geannuleerd", () => {
    for (const to of taskStatuses) {
      expect(findTransition("cancelled", to)).toBeUndefined();
    }
    expect(isFinalStatus("cancelled")).toBe(true);
    for (const status of taskStatuses.filter((s) => s !== "cancelled")) {
      expect(isFinalStatus(status)).toBe(false);
    }
  });

  it("only cancels from Open and Toegewezen, so a cancelled task never has hours", () => {
    for (const from of origins) {
      expect(findTransition(from, "cancelled") !== undefined).toBe(
        from === "open" || from === "assigned",
      );
    }
  });
});

describe("an inactive actor", () => {
  it("can do nothing, whatever the role", () => {
    for (const transition of TRANSITIONS) {
      const request = validRequest(transition.from, transition.to);
      expect(checkTransition({ ...request, actor: { ...request.actor, isActive: false } })).toEqual(
        { allowed: false, reason: "actor_inactive" },
      );
    }
  });
});

describe("creating a task (createTask)", () => {
  it("is Open without a technician", () => {
    expect(canTransition({ from: "new", to: "open", actor: backoffice })).toBe(true);
    expect(canTransition({ from: "new", to: "open", actor: backoffice, newAssignee: null })).toBe(
      true,
    );
  });

  it("refuses Open with a technician", () => {
    expect(
      checkTransition({ from: "new", to: "open", actor: backoffice, newAssignee: kevin }),
    ).toEqual({ allowed: false, reason: "assignee_not_allowed" });
  });

  it("is Toegewezen with an active technician", () => {
    expect(
      canTransition({ from: "new", to: "assigned", actor: backoffice, newAssignee: kevin }),
    ).toBe(true);
  });

  it("refuses Toegewezen without, with a deactivated or with a non-technician assignee", () => {
    const base = { from: "new", to: "assigned", actor: backoffice } as const;
    expect(checkTransition(base)).toEqual({ allowed: false, reason: "assignee_required" });
    expect(checkTransition({ ...base, newAssignee: null })).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
    expect(checkTransition({ ...base, newAssignee: { ...kevin, isActive: false } })).toEqual({
      allowed: false,
      reason: "assignee_inactive",
    });
    expect(checkTransition({ ...base, newAssignee: { ...kevin, role: "backoffice" } })).toEqual({
      allowed: false,
      reason: "assignee_not_technician",
    });
  });
});

describe("assigning and unassigning (updateTask)", () => {
  it("Open to Toegewezen needs an active technician", () => {
    const base = { from: "open", to: "assigned", actor: backoffice } as const;
    expect(canTransition({ ...base, newAssignee: kevin })).toBe(true);
    expect(checkTransition(base)).toEqual({ allowed: false, reason: "assignee_required" });
    expect(checkTransition({ ...base, newAssignee: { ...kevin, isActive: false } })).toEqual({
      allowed: false,
      reason: "assignee_inactive",
    });
  });

  it("Toegewezen to Toegewezen needs another technician", () => {
    const base = {
      from: "assigned",
      to: "assigned",
      actor: backoffice,
      currentAssigneeId: KEVIN,
    } as const;
    expect(canTransition({ ...base, newAssignee: bram })).toBe(true);
    expect(checkTransition({ ...base, newAssignee: kevin })).toEqual({
      allowed: false,
      reason: "assignee_unchanged",
    });
    expect(checkTransition({ ...base, newAssignee: { ...bram, isActive: false } })).toEqual({
      allowed: false,
      reason: "assignee_inactive",
    });
    expect(checkTransition(base)).toEqual({ allowed: false, reason: "assignee_required" });
  });

  it("Toegewezen to Open (Nog niet toewijzen) clears the technician", () => {
    const base = {
      from: "assigned",
      to: "open",
      actor: backoffice,
      currentAssigneeId: KEVIN,
    } as const;
    expect(canTransition(base)).toBe(true);
    expect(canTransition({ ...base, newAssignee: null })).toBe(true);
    expect(checkTransition({ ...base, newAssignee: bram })).toEqual({
      allowed: false,
      reason: "assignee_not_allowed",
    });
  });

  it("is refused for a technician", () => {
    expect(
      checkTransition({
        from: "open",
        to: "assigned",
        actor: kevinActor,
        newAssignee: kevin,
      }),
    ).toEqual({ allowed: false, reason: "wrong_role" });
  });
});

describe("picking up (pickUpTask)", () => {
  const base = { from: "assigned", to: "picked_up" } as const;

  it("is allowed for the assigned technician, also when he has other picked up tasks (K5)", () => {
    expect(canTransition({ ...base, actor: kevinActor, currentAssigneeId: KEVIN })).toBe(true);
  });

  it("is refused for a colleague", () => {
    expect(
      checkTransition({
        ...base,
        actor: { id: BRAM, role: "technician", isActive: true },
        currentAssigneeId: KEVIN,
      }),
    ).toEqual({ allowed: false, reason: "not_assignee" });
  });

  it("is refused when the task has no technician", () => {
    expect(checkTransition({ ...base, actor: kevinActor, currentAssigneeId: null })).toEqual({
      allowed: false,
      reason: "not_assignee",
    });
    expect(checkTransition({ ...base, actor: kevinActor })).toEqual({
      allowed: false,
      reason: "not_assignee",
    });
  });

  it("is refused for the back office, which cannot pick up for a technician", () => {
    expect(checkTransition({ ...base, actor: backoffice, currentAssigneeId: KEVIN })).toEqual({
      allowed: false,
      reason: "wrong_role",
    });
  });
});

describe("resetting (resetTask)", () => {
  const base = { from: "picked_up", to: "assigned", actor: backoffice } as const;

  it("is allowed with the same or another active technician", () => {
    expect(canTransition({ ...base, currentAssigneeId: KEVIN, newAssignee: kevin })).toBe(true);
    expect(canTransition({ ...base, currentAssigneeId: KEVIN, newAssignee: bram })).toBe(true);
  });

  it("needs an active technician", () => {
    expect(checkTransition({ ...base, currentAssigneeId: KEVIN })).toEqual({
      allowed: false,
      reason: "assignee_required",
    });
    expect(
      checkTransition({
        ...base,
        currentAssigneeId: KEVIN,
        newAssignee: { ...kevin, isActive: false },
      }),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
  });
});

describe("completing (completeTask)", () => {
  const base = { from: "picked_up", to: "completed", currentAssigneeId: KEVIN } as const;

  it("is allowed for the own task with hours per quarter", () => {
    for (const workedMinutes of [15, 30, 90, 960]) {
      expect(canTransition({ ...base, actor: kevinActor, workedMinutes })).toBe(true);
    }
  });

  it("does not know a maximum: that is in the Zod schema", () => {
    expect(canTransition({ ...base, actor: kevinActor, workedMinutes: 99 * 60 })).toBe(true);
  });

  it("refuses 0, negative, no quarter, fractions and no hours", () => {
    for (const workedMinutes of [0, -15, 10, 100, 22.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkTransition({ ...base, actor: kevinActor, workedMinutes })).toEqual({
        allowed: false,
        reason: "hours_invalid",
      });
    }
    expect(checkTransition({ ...base, actor: kevinActor })).toEqual({
      allowed: false,
      reason: "hours_invalid",
    });
  });

  it("is refused for a colleague", () => {
    expect(
      checkTransition({
        ...base,
        actor: { id: BRAM, role: "technician", isActive: true },
        workedMinutes: 60,
      }),
    ).toEqual({ allowed: false, reason: "not_assignee" });
  });

  it("is refused for the back office (V10: no completing on behalf of a technician)", () => {
    expect(checkTransition({ ...base, actor: backoffice, workedMinutes: 60 })).toEqual({
      allowed: false,
      reason: "wrong_role",
    });
  });
});

describe("correcting hours (correctHours)", () => {
  const base = { from: "completed", to: "completed", actor: backoffice } as const;

  it("needs valid hours and a reason", () => {
    expect(canTransition({ ...base, correctedMinutes: 90, correctionReason: "Pauze" })).toBe(true);
  });

  it("refuses invalid hours", () => {
    for (const correctedMinutes of [0, -15, 20, 7.5]) {
      expect(checkTransition({ ...base, correctedMinutes, correctionReason: "Pauze" })).toEqual({
        allowed: false,
        reason: "hours_invalid",
      });
    }
    expect(checkTransition({ ...base, correctionReason: "Pauze" })).toEqual({
      allowed: false,
      reason: "hours_invalid",
    });
  });

  it("refuses a missing, empty or blank reason", () => {
    for (const correctionReason of [undefined, "", "   ", "\n\t"]) {
      expect(checkTransition({ ...base, correctedMinutes: 90, correctionReason })).toEqual({
        allowed: false,
        reason: "reason_required",
      });
    }
  });

  it("is refused for a technician", () => {
    expect(
      checkTransition({
        ...base,
        actor: kevinActor,
        correctedMinutes: 90,
        correctionReason: "Pauze",
      }),
    ).toEqual({ allowed: false, reason: "wrong_role" });
  });

  it("exists only from Afgewerkt to Afgewerkt: on Gefactureerd the mark must be undone first", () => {
    const corrections = TRANSITIONS.filter((t) => t.action === "correctHours");
    expect(corrections.map((t) => `${t.from} -> ${t.to}`)).toEqual(["completed -> completed"]);
    expect(findTransition("invoiced", "invoiced")).toBeUndefined();
    expect(
      checkTransition({
        from: "invoiced",
        to: "invoiced",
        actor: backoffice,
        correctedMinutes: 90,
        correctionReason: "Pauze",
      }),
    ).toEqual({ allowed: false, reason: "transition_not_allowed" });
  });
});

describe("invoicing (markInvoiced, unmarkInvoiced)", () => {
  it("marks Afgewerkt as Gefactureerd and back, for the back office only", () => {
    expect(canTransition({ from: "completed", to: "invoiced", actor: backoffice })).toBe(true);
    expect(canTransition({ from: "invoiced", to: "completed", actor: backoffice })).toBe(true);
    expect(canTransition({ from: "completed", to: "invoiced", actor: kevinActor })).toBe(false);
    expect(canTransition({ from: "invoiced", to: "completed", actor: kevinActor })).toBe(false);
  });
});

describe("cancelling (cancelTask)", () => {
  it("is allowed from Open and Toegewezen, with or without a reason", () => {
    for (const from of ["open", "assigned"] as const) {
      expect(canTransition({ from, to: "cancelled", actor: backoffice })).toBe(true);
    }
  });

  it("is refused from Opgepikt (reset first), Afgewerkt, Gefactureerd and Geannuleerd", () => {
    for (const from of ["picked_up", "completed", "invoiced", "cancelled"] as const) {
      expect(checkTransition({ from, to: "cancelled", actor: backoffice })).toEqual({
        allowed: false,
        reason: "transition_not_allowed",
      });
    }
  });

  it("is refused for a technician, also for his own task", () => {
    expect(
      checkTransition({
        from: "assigned",
        to: "cancelled",
        actor: kevinActor,
        currentAssigneeId: KEVIN,
      }),
    ).toEqual({ allowed: false, reason: "wrong_role" });
  });
});

describe("transitionsFrom", () => {
  it("lists what a role can start from a status (the actions of screen B3)", () => {
    const actions = (from: TransitionFrom, role: ActorRole) =>
      transitionsFrom(from, role).map((t) => t.action);

    expect(actions("open", "backoffice")).toEqual(["updateTask", "cancelTask"]);
    expect(actions("assigned", "backoffice")).toEqual(["updateTask", "updateTask", "cancelTask"]);
    expect(actions("picked_up", "backoffice")).toEqual(["resetTask"]);
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
  it("is possible for Open, Toegewezen and Opgepikt only", () => {
    const editable = taskStatuses.filter((status) => canEditTask(status));
    expect(editable).toEqual(["open", "assigned", "picked_up"]);
  });

  it("can change the technician in the form for Open and Toegewezen only", () => {
    const changeable = taskStatuses.filter((status) => canChangeAssigneeInEditForm(status));
    expect(changeable).toEqual(["open", "assigned"]);
  });
});
