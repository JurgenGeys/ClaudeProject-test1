import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess } = vi.hoisted(() => ({ checkRoleAccess: vi.fn() }));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("next/navigation", () => ({ usePathname: () => "/tasks" }));
// The real button posts to a Server Action, which cannot run in a unit test.
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button>Uitloggen</button>,
}));

import { RoleGate } from "./role-gate";

const sofie = {
  id: "u2",
  email: "s@x.be",
  fullName: "Sofie Peeters",
  role: "backoffice" as const,
};
const kevin = { id: "u1", email: "k@x.be", fullName: "Kevin Wouters", role: "technician" as const };

beforeEach(() => {
  checkRoleAccess.mockReset();
});

// RoleGate is an async Server Component: call it and render the element it returns.
async function renderGate(role: "technician" | "backoffice") {
  render(await RoleGate({ role, children: <p>Inhoud van de pagina</p> }));
}

describe("RoleGate", () => {
  it("shows the name, the sign-out button and the page for the right role", async () => {
    checkRoleAccess.mockResolvedValue({ kind: "allowed", user: kevin });
    await renderGate("technician");
    expect(screen.getByText("Kevin Wouters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uitloggen" })).toBeInTheDocument();
    expect(screen.getByText("Inhoud van de pagina")).toBeInTheDocument();
    expect(checkRoleAccess).toHaveBeenCalledWith("technician");
  });

  it("replaces the page with the 'not for you' page for the wrong role, but keeps the sign-out button", async () => {
    checkRoleAccess.mockResolvedValue({ kind: "wrong-role", user: kevin });
    await renderGate("backoffice");
    expect(screen.queryByText("Inhoud van de pagina")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Deze pagina is niet voor jou bedoeld" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar mijn taken" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uitloggen" })).toBeInTheDocument();
  });

  describe("header and layout follow the role of the signed-in user", () => {
    it("gives backoffice the main menu and the wide layout", async () => {
      checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
      await renderGate("backoffice");
      expect(screen.getByRole("navigation", { name: "Hoofdmenu" })).toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveClass("max-w-6xl");
      expect(screen.getByRole("main")).not.toHaveClass("max-w-md");
    });

    it("gives a technician no menu and the narrow layout", async () => {
      checkRoleAccess.mockResolvedValue({ kind: "allowed", user: kevin });
      await renderGate("technician");
      expect(screen.queryByRole("navigation", { name: "Hoofdmenu" })).not.toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveClass("max-w-md");
    });

    it("gives a technician on a backoffice page no menu and the narrow layout", async () => {
      checkRoleAccess.mockResolvedValue({ kind: "wrong-role", user: kevin });
      await renderGate("backoffice");
      expect(screen.queryByRole("navigation", { name: "Hoofdmenu" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Klanten" })).not.toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveClass("max-w-md");
      expect(screen.getByRole("main")).not.toHaveClass("max-w-6xl");
    });

    it("gives backoffice on a technician page the menu and the wide layout", async () => {
      checkRoleAccess.mockResolvedValue({ kind: "wrong-role", user: sofie });
      await renderGate("technician");
      expect(screen.getByRole("navigation", { name: "Hoofdmenu" })).toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveClass("max-w-6xl");
      expect(screen.getByRole("link", { name: "Naar de taken" })).toBeInTheDocument();
    });
  });
});
