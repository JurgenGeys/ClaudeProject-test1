import { describe, expect, it } from "vitest";

import { sortTechnicians, technicianStatus, technicianStatusLabel } from "./status";

describe("technicianStatus", () => {
  it.each([
    [{ isActive: true, invitePending: false }, "active", "Actief"],
    [{ isActive: true, invitePending: true }, "invited", "Uitgenodigd"],
    [{ isActive: false, invitePending: false }, "disabled", "Uitgeschakeld"],
    // Switched off wins, also for someone who never accepted the invitation.
    [{ isActive: false, invitePending: true }, "disabled", "Uitgeschakeld"],
  ] as const)("%j is %s", (profile, status, label) => {
    expect(technicianStatus(profile)).toBe(status);
    expect(technicianStatusLabel(status)).toBe(label);
  });
});

describe("sortTechnicians", () => {
  it("puts switched-off technicians last and sorts by name within each group", () => {
    const list = [
      { fullName: "tom", status: "disabled" },
      { fullName: "Yana", status: "invited" },
      { fullName: "Éline", status: "active" },
      { fullName: "Bram", status: "active" },
      { fullName: "Adam", status: "disabled" },
    ] as const;
    expect(sortTechnicians(list).map((t) => t.fullName)).toEqual([
      "Bram",
      "Éline",
      "Yana",
      "Adam",
      "tom",
    ]);
  });

  it("does not change the input", () => {
    const list = [
      { fullName: "B", status: "active" as const },
      { fullName: "A", status: "active" as const },
    ];
    sortTechnicians(list);
    expect(list.map((t) => t.fullName)).toEqual(["B", "A"]);
  });
});
