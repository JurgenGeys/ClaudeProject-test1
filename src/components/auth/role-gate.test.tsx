import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess } = vi.hoisted(() => ({ checkRoleAccess: vi.fn() }));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
// The real button posts to a Server Action, which cannot run in a unit test.
vi.mock("next/navigation", () => ({ usePathname: () => "/tasks" }));
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button>Uitloggen</button>,
}));

import { RoleGate } from "./role-gate";

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
});
