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
const insertCustomer = vi.fn();
const updateCustomerFields = vi.fn();
vi.mock("@/lib/customers/save", () => ({
  insertCustomer: (...args: unknown[]) => insertCustomer(...args),
  updateCustomerFields: (...args: unknown[]) => updateCustomerFields(...args),
}));
vi.mock("@/lib/customers/search", () => ({ findCustomers: vi.fn() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

import { AuthError } from "@/lib/auth/session";

import { createCustomer, updateCustomer } from "./actions";

const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};
const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  requireRole.mockResolvedValue(sofie);
  insertCustomer.mockResolvedValue(ID);
  updateCustomerFields.mockResolvedValue(true);
});

describe.each([
  ["createCustomer", createCustomer, { name: "Fam. Hermans" }],
  ["updateCustomer", updateCustomer, { id: ID, name: "Fam. Hermans" }],
])("%s: access", (_name, action, values) => {
  it("checks the backoffice role first and writes nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    expect(await action(null, formData(values))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(insertCustomer).not.toHaveBeenCalled();
    expect(updateCustomerFields).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(action(null, formData(values))).rejects.toThrow("boom");
  });

  it("reports every wrong field and writes nothing", async () => {
    expect(
      await action(null, formData({ ...values, name: "", postalCode: "12", email: "x" })),
    ).toEqual({
      ok: false,
      fieldErrors: {
        name: "Vul de naam van de klant in.",
        postalCode: "Vul een geldige postcode in (4 cijfers).",
        email: "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
      },
    });
    expect(insertCustomer).not.toHaveBeenCalled();
    expect(updateCustomerFields).not.toHaveBeenCalled();
  });
});

describe("createCustomer", () => {
  it("saves the validated customer for the user and continues to the customer page", async () => {
    await expect(
      createCustomer(
        null,
        formData({ name: " Fam. Hermans ", city: "Vosselaar", createdBy: "forged" }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /customers/${ID}?saved=1`);
    expect(insertCustomer).toHaveBeenCalledWith(db, "s1", {
      name: "Fam. Hermans",
      street: null,
      postalCode: null,
      city: "Vosselaar",
      phone: null,
      email: null,
      notes: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("reports a technical problem when saving fails, without logging what was typed", async () => {
    insertCustomer.mockRejectedValue(
      Object.assign(new Error("insert 'Fam. Hermans'"), { code: "08006" }),
    );
    expect(await createCustomer(null, formData({ name: "Fam. Hermans" }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Hermans");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("updateCustomer", () => {
  it("saves the fields of the customer with the id of the form and continues to the page", async () => {
    await expect(
      updateCustomer(null, formData({ id: ID, name: "Fam. Hermans", phone: "0472 58 61 14" })),
    ).rejects.toThrow(`NEXT_REDIRECT /customers/${ID}?saved=1`);
    expect(updateCustomerFields).toHaveBeenCalledWith(
      db,
      ID,
      expect.objectContaining({ name: "Fam. Hermans", phone: "0472 58 61 14", street: null }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it.each(["", "not-a-uuid"])("refuses the id %j without writing", async (id) => {
    expect(await updateCustomer(null, formData({ id, name: "X" }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze klant bestaat niet (meer).",
    });
    expect(updateCustomerFields).not.toHaveBeenCalled();
  });

  it("says so when the customer does not exist any more", async () => {
    updateCustomerFields.mockResolvedValue(false);
    expect(await updateCustomer(null, formData({ id: ID, name: "X" }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze klant bestaat niet (meer).",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("reports a technical problem when saving fails", async () => {
    updateCustomerFields.mockRejectedValue(new Error("boom"));
    expect(await updateCustomer(null, formData({ id: ID, name: "X" }))).toMatchObject({
      ok: false,
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
  });
});
