import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, listAssignableTechnicians, getCustomerForNewTask } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  listAssignableTechnicians: vi.fn(),
  getCustomerForNewTask: vi.fn(),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/customers/lookup", () => ({ getCustomerForNewTask }));
vi.mock("@/lib/technicians/queries", () => ({ listAssignableTechnicians }));
vi.mock("../actions", () => ({ createTask: vi.fn() }));
vi.mock("../../customers/actions", () => ({ searchCustomers: vi.fn() }));

import NewTaskPage, { metadata } from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

/** The page for these query parameters (`/tasks/new?customer=...`). */
function page(searchParams: Record<string, string | string[] | undefined> = {}) {
  return NewTaskPage({ searchParams: Promise.resolve(searchParams) } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  getCustomerForNewTask.mockResolvedValue(null);
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  listAssignableTechnicians.mockResolvedValue([
    { id: "t1", fullName: "Kevin Wouters" },
    { id: "t2", fullName: "Jens Maes" },
  ]);
});

describe("the new task page (B2)", () => {
  it("checks the backoffice role itself", async () => {
    render(await page());
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
  });

  it("has the title, the legend, a way back and the form with the assignable technicians", async () => {
    render(await page());
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
      expect(await page()).toBeNull();
      expect(listAssignableTechnicians).not.toHaveBeenCalled();
    },
  );

  it("starts with the customer of ?customer= chosen and his address as the location", async () => {
    getCustomerForNewTask.mockResolvedValue({
      id: "c1",
      name: "Bakkerij De Gouden Korst",
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    render(await page({ customer: "c1" }));
    expect(getCustomerForNewTask).toHaveBeenCalledWith("c1");
    expect(screen.getByText("Bakkerij De Gouden Korst")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Andere klant kiezen" })).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="customerId"]')?.value).toBe("c1");
    expect(screen.getByLabelText(/^Straat en nummer/)).toHaveValue("Gasthuisstraat 23");
    expect(screen.getByLabelText(/^Postcode/)).toHaveValue("2300");
    expect(screen.getByLabelText(/^Gemeente/)).toHaveValue("Turnhout");
  });

  it("starts empty when the customer is not found", async () => {
    render(await page({ customer: "nope" }));
    expect(screen.queryByRole("button", { name: "Andere klant kiezen" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Straat en nummer/)).toHaveValue("");
  });
});
