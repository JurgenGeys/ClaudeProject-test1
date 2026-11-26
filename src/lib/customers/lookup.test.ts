import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
const getDb = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));

import { AuthError } from "@/lib/auth/session";

import { getCustomerForNewTask, queryCustomerById } from "./lookup";

const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";

/** A database whose `select` chain ends in `rows`. */
function dbWith(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })), where };
}

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ id: "s1", role: "backoffice" });
});

describe("queryCustomerById", () => {
  it("returns the customer, or null when there is none", async () => {
    const found = {
      id: ID,
      name: "Bakkerij",
      street: null,
      postalCode: null,
      city: null,
      phone: null,
    };
    expect(await queryCustomerById(dbWith([found]) as never, ID)).toEqual(found);
    expect(await queryCustomerById(dbWith([]) as never, ID)).toBeNull();
  });
});

describe("getCustomerForNewTask", () => {
  it("checks the backoffice role before anything else", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    await expect(getCustomerForNewTask(ID)).rejects.toBeInstanceOf(AuthError);
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "abc", ["a", "b"], "1; drop table customers"])(
    "gives null for the parameter %j, without reading the database",
    async (value) => {
      expect(await getCustomerForNewTask(value)).toBeNull();
      expect(getDb).not.toHaveBeenCalled();
    },
  );
});
