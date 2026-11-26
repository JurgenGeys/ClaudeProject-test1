import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess } = vi.hoisted(() => ({ checkRoleAccess: vi.fn() }));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("../actions", () => ({ createCustomer: vi.fn(), updateCustomer: vi.fn() }));

import NewCustomerPage, { metadata } from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
});

describe("the new customer page (B6)", () => {
  it("checks the role, and has the title, the legend, a way back and an empty form", async () => {
    render(await NewCustomerPage());
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
    expect(metadata.title).toBe("Nieuwe klant");
    expect(screen.getByRole("heading", { level: 1, name: "Nieuwe klant" })).toBeInTheDocument();
    expect(screen.getByText(/zijn verplicht\./)).toHaveTextContent("Velden met * zijn verplicht.");
    expect(screen.getByRole("link", { name: "← Klanten" })).toHaveAttribute("href", "/customers");
    expect(screen.getByLabelText(/^Naam/)).toHaveValue("");
    expect(screen.queryByText("Taken voor deze klant")).not.toBeInTheDocument();
  });

  it.each([["wrong-role"], ["unavailable"]])("renders nothing for access '%s'", async (kind) => {
    checkRoleAccess.mockResolvedValue({ kind });
    expect(await NewCustomerPage()).toBeNull();
  });
});
