import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, listAssignableTechnicians } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  listAssignableTechnicians: vi.fn(),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/technicians/queries", () => ({ listAssignableTechnicians }));
vi.mock("../actions", () => ({ createTask: vi.fn() }));
vi.mock("../../customers/actions", () => ({ searchCustomers: vi.fn() }));

import NewTaskPage, { metadata } from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  listAssignableTechnicians.mockResolvedValue([
    { id: "t1", fullName: "Kevin Wouters" },
    { id: "t2", fullName: "Jens Maes" },
  ]);
});

describe("the new task page (B2)", () => {
  it("checks the backoffice role itself", async () => {
    render(await NewTaskPage());
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
  });

  it("has the title, the legend, a way back and the form with the assignable technicians", async () => {
    render(await NewTaskPage());
    expect(metadata.title).toBe("Nieuwe taak");
    expect(screen.getByRole("heading", { level: 1, name: "Nieuwe taak" })).toBeInTheDocument();
    expect(screen.getByText(/zijn verplicht\./)).toHaveTextContent("Velden met * zijn verplicht.");
    expect(screen.getByRole("link", { name: "← Taken" })).toHaveAttribute("href", "/tasks");
    const options = within(screen.getByLabelText("Technieker")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Nog niet toewijzen",
      "Kevin Wouters",
      "Jens Maes",
    ]);
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing and reads no technicians for access '%s' (the layout shows the message)",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind, user: { ...sofie, role: "technician" } });
      expect(await NewTaskPage()).toBeNull();
      expect(listAssignableTechnicians).not.toHaveBeenCalled();
    },
  );
});
