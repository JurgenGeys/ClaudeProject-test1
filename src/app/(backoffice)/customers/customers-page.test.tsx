import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, getCustomerList } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  getCustomerList: vi.fn(),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/customers/list", () => ({ getCustomerList }));

import type { CustomerList, CustomerListRow } from "@/lib/customers/list";

import CustomersPage, { metadata } from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

const bakker: CustomerListRow = {
  id: "c1",
  name: "Bakkerij De Gouden Korst",
  street: "Gasthuisstraat 23",
  postalCode: "2300",
  city: "Turnhout",
  phone: "014 41 22 87",
  taskCount: 5,
  lastTaskDate: "2026-11-23",
};
const bare: CustomerListRow = {
  id: "c2",
  name: "Fam. Hermans",
  street: null,
  postalCode: null,
  city: null,
  phone: null,
  taskCount: 1,
  lastTaskDate: null,
};

function list(overrides: Partial<CustomerList> = {}): CustomerList {
  return {
    params: { q: "", page: 1 },
    rows: [bakker, bare],
    total: 2,
    pageCount: 1,
    hasAnyCustomer: true,
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await CustomersPage({ searchParams: Promise.resolve(searchParams) } as never));
}

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  getCustomerList.mockResolvedValue(list());
});

describe("the customers page (B5)", () => {
  it("checks the backoffice role itself and passes the URL parameters on", async () => {
    await renderPage({ q: "turnhout" });
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
    expect(getCustomerList).toHaveBeenCalledWith({ q: "turnhout" });
    expect(metadata.title).toBe("Klanten");
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing and reads no customers for access '%s'",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind });
      expect(await CustomersPage({ searchParams: Promise.resolve({}) } as never)).toBeNull();
      expect(getCustomerList).not.toHaveBeenCalled();
    },
  );

  it("has the title, a button for a new customer and a labelled search field", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Klanten" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nieuwe klant" })).toHaveAttribute(
      "href",
      "/customers/new",
    );
    const search = screen.getByRole("searchbox", { name: "Zoeken" });
    expect(search).toHaveAttribute("name", "q");
    expect(search).toHaveAttribute("placeholder", "Naam, gemeente of telefoon");
    expect(search.closest("form")).toHaveAttribute("method", "get");
    expect(search.closest("form")).toHaveAttribute("action", "/customers");
  });

  it("shows the search text again in the field", async () => {
    getCustomerList.mockResolvedValue(list({ params: { q: "turnhout", page: 1 } }));
    await renderPage({ q: "turnhout" });
    expect(screen.getByRole("searchbox", { name: "Zoeken" })).toHaveValue("turnhout");
  });

  it("lists the customers in a table with the columns of the design and links to B6", async () => {
    await renderPage();
    const table = screen.getByRole("table", { name: "Klanten" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Naam", "Adres", "Telefoon", "Taken", "Laatste taak"]);
    const row = within(table).getByRole("row", { name: /Bakkerij De Gouden Korst/ });
    expect(within(row).getByRole("link", { name: "Bakkerij De Gouden Korst" })).toHaveAttribute(
      "href",
      "/customers/c1",
    );
    expect(row).toHaveTextContent("Gasthuisstraat 23, 2300 Turnhout");
    expect(row).toHaveTextContent("014 41 22 87");
    expect(row).toHaveTextContent("5");
    expect(row).toHaveTextContent("ma 23/11/2026");
  });

  it("says 'onbekend' for what is not known, for a screen reader", async () => {
    await renderPage();
    const row = within(screen.getByRole("table", { name: "Klanten" })).getByRole("row", {
      name: /Fam. Hermans/,
    });
    expect(within(row).getAllByText("onbekend")).toHaveLength(3);
  });

  it("also has a list of cards for a phone", async () => {
    await renderPage();
    const cards = screen.getByRole("list", { name: "Klanten" });
    const card = within(cards).getByRole("link", { name: /Bakkerij De Gouden Korst/ });
    expect(card).toHaveAttribute("href", "/customers/c1");
    expect(card).toHaveTextContent("5 taken · laatste ma 23/11/2026");
    expect(within(cards).getByRole("link", { name: /Fam. Hermans/ })).toHaveTextContent("1 taak");
  });

  it("shows the empty state, with one button, when there are no customers at all", async () => {
    getCustomerList.mockResolvedValue(list({ rows: [], total: 0, hasAnyCustomer: false }));
    await renderPage();
    expect(screen.getByText("Er zijn nog geen klanten.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Klanten worden ook automatisch toegevoegd als je een taak voor een nieuwe klant aanmaakt\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Nieuwe klant" })).toHaveLength(1);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("says that nothing was found for the search text, with a way out", async () => {
    getCustomerList.mockResolvedValue(list({ params: { q: "xyz", page: 1 }, rows: [], total: 0 }));
    await renderPage({ q: "xyz" });
    expect(screen.getByText("Geen klant gevonden voor 'xyz'.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alle klanten tonen" })).toHaveAttribute(
      "href",
      "/customers",
    );
    expect(screen.getByRole("link", { name: "Nieuwe klant aanmaken" })).toHaveAttribute(
      "href",
      "/customers/new",
    );
  });

  it("shows no pagination for one page, and links that keep the search for more", async () => {
    await renderPage();
    expect(screen.queryByRole("navigation", { name: "Paginering" })).not.toBeInTheDocument();
  });

  it("links to the previous and next page and keeps the search text", async () => {
    getCustomerList.mockResolvedValue(
      list({ params: { q: "turn", page: 2 }, pageCount: 3, total: 120 }),
    );
    await renderPage({ q: "turn", page: "2" });
    const pagination = screen.getByRole("navigation", { name: "Paginering" });
    expect(pagination).toHaveTextContent("Klanten 51 tot 100 van 120 (pagina 2 van 3)");
    expect(within(pagination).getByRole("link", { name: "Vorige" })).toHaveAttribute(
      "href",
      "/customers?q=turn",
    );
    expect(within(pagination).getByRole("link", { name: "Volgende" })).toHaveAttribute(
      "href",
      "/customers?q=turn&page=3",
    );
  });

  it("has no 'Vorige' on the first page and no 'Volgende' on the last", async () => {
    getCustomerList.mockResolvedValue(list({ pageCount: 2, total: 80 }));
    await renderPage();
    expect(screen.queryByRole("link", { name: "Vorige" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volgende" })).toBeInTheDocument();
  });
});
