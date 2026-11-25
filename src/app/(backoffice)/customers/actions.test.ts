import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const db = { marker: "db" };
vi.mock("@/db/client", () => ({ getDb: () => db }));
const findCustomers = vi.fn();
vi.mock("@/lib/customers/search", () => ({
  findCustomers: (...args: unknown[]) => findCustomers(...args),
}));

import { AuthError } from "@/lib/auth/session";

import { searchCustomers } from "./actions";

const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};
const bakker = {
  id: "c1",
  name: "Bakkerij De Gouden Korst",
  street: "Gasthuisstraat 23",
  postalCode: "2300",
  city: "Turnhout",
  phone: "014 41 22 87",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(sofie);
  findCustomers.mockResolvedValue([bakker]);
});

describe("searchCustomers", () => {
  it("requires the backoffice role and searches nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    expect(await searchCustomers("bak")).toEqual({
      ok: false,
      message: "Je hebt geen toegang om dit te doen.",
    });
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(findCustomers).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(searchCustomers("bak")).rejects.toThrow("boom");
  });

  it("returns the customers that the query finds", async () => {
    expect(await searchCustomers("bak")).toEqual({ ok: true, customers: [bakker] });
    expect(findCustomers).toHaveBeenCalledWith(db, "bak");
  });

  it("finds nothing for a text that is not a short search text, without a query", async () => {
    for (const text of ["x".repeat(101), 42 as unknown as string, undefined as unknown as string]) {
      expect(await searchCustomers(text)).toEqual({ ok: true, customers: [] });
    }
    expect(findCustomers).not.toHaveBeenCalled();
  });

  it("reports a technical problem when the query fails, without logging what was searched", async () => {
    findCustomers.mockRejectedValue(new Error("select ... 'bak'"));
    expect(await searchCustomers("bak")).toEqual({
      ok: false,
      message: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("bak");
  });
});
