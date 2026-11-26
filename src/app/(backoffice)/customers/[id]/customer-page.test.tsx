import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, getCustomerDetail, notFound } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  getCustomerDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/customers/list", () => ({ getCustomerDetail }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../actions", () => ({ createCustomer: vi.fn(), updateCustomer: vi.fn() }));

import type { CustomerDetail } from "@/lib/customers/list";

import CustomerNotFound from "./not-found";
import CustomerPage, { metadata } from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };
const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";

const customer: CustomerDetail = {
  id: ID,
  name: "Bakkerij De Gouden Korst",
  street: "Gasthuisstraat 23",
  postalCode: "2300",
  city: "Turnhout",
  phone: "014 41 22 87",
  email: null,
  notes: "Ingang via de achterdeur.",
  tasks: [
    {
      number: 1042,
      scheduledDate: "2026-11-23",
      startTime: "08:00:00",
      workType: "maintenance",
      status: "picked_up",
      instructions: "\n  Jaarlijks onderhoud 2 split-units\nTweede regel",
      technicianName: "Kevin Wouters",
    },
    {
      number: 1031,
      scheduledDate: "2026-10-02",
      startTime: "13:00:00",
      workType: "repair",
      status: "cancelled",
      instructions: "Toestel lekt",
      technicianName: null,
    },
  ],
};

function page(id: string, searchParams: Record<string, string> = {}) {
  return CustomerPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  getCustomerDetail.mockResolvedValue(customer);
  notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
});

describe("the customer page (B6)", () => {
  it("checks the role, and shows the name as title, the form and a way back", async () => {
    render(await page(ID));
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
    expect(getCustomerDetail).toHaveBeenCalledWith(ID);
    expect(metadata.title).toBe("Klant");
    expect(
      screen.getByRole("heading", { level: 1, name: "Bakkerij De Gouden Korst" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Klanten" })).toHaveAttribute("href", "/customers");
    expect(screen.getByLabelText(/^Naam/)).toHaveValue("Bakkerij De Gouden Korst");
    expect(screen.getByLabelText("Opmerkingen")).toHaveValue("Ingang via de achterdeur.");
  });

  it("links to a new task for this customer", async () => {
    render(await page(ID));
    expect(screen.getByRole("link", { name: "+ Nieuwe taak voor deze klant" })).toHaveAttribute(
      "href",
      `/tasks/new?customer=${ID}`,
    );
  });

  it("lists the tasks of the customer, cancelled ones too, each linking to B3", async () => {
    render(await page(ID));
    const section = screen.getByRole("region", { name: "Taken voor deze klant" });
    const rows = within(section).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", "/tasks/1042");
    expect(rows[0]).toHaveTextContent("#1042");
    expect(rows[0]).toHaveTextContent("ma 23/11/2026");
    expect(rows[0]).toHaveTextContent(
      "Onderhoud · Kevin Wouters · Jaarlijks onderhoud 2 split-units",
    );
    expect(rows[0]).not.toHaveTextContent("Tweede regel");
    expect(rows[0]).toHaveTextContent("Opgepikt");
    expect(rows[1]).toHaveAttribute("href", "/tasks/1031");
    expect(rows[1]).toHaveTextContent("Herstelling · Nog niet toegewezen · Toestel lekt");
    expect(rows[1]).toHaveTextContent("Geannuleerd");
  });

  it("says so when the customer has no tasks", async () => {
    getCustomerDetail.mockResolvedValue({ ...customer, tasks: [] });
    render(await page(ID));
    expect(screen.getByText("Er zijn nog geen taken voor deze klant.")).toBeInTheDocument();
  });

  it("shows 'Klant bewaard.' after a save, and not otherwise", async () => {
    render(await page(ID, { saved: "1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Klant bewaard.");
  });

  it("does not show the confirmation without ?saved=1", async () => {
    render(await page(ID));
    expect(screen.queryByText("Klant bewaard.")).not.toBeInTheDocument();
  });

  it("gives 'not found' for an id that is not a UUID, without a query", async () => {
    await expect(page("new")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCustomerDetail).not.toHaveBeenCalled();
  });

  it("gives 'not found' for a customer that does not exist", async () => {
    getCustomerDetail.mockResolvedValue(null);
    await expect(page(ID)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing and reads no customer for access '%s'",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind });
      expect(await page(ID)).toBeNull();
      expect(getCustomerDetail).not.toHaveBeenCalled();
    },
  );
});

describe("the 'not found' page of a customer", () => {
  it("says the customer does not exist and leads back to the list", () => {
    render(<CustomerNotFound />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Deze klant bestaat niet (meer)." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar de klanten" })).toHaveAttribute(
      "href",
      "/customers",
    );
  });
});
