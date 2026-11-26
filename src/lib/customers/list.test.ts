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

import { getCustomerDetail, getCustomerList } from "./list";

const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getCustomerList", () => {
  it("checks the backoffice role first, passes the AuthError on and reads nothing", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    await expect(getCustomerList({})).rejects.toBeInstanceOf(AuthError);
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("getCustomerDetail", () => {
  it("checks the backoffice role first, passes the AuthError on and reads nothing", async () => {
    requireRole.mockRejectedValue(new AuthError("unauthenticated"));
    await expect(getCustomerDetail(ID)).rejects.toBeInstanceOf(AuthError);
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(getDb).not.toHaveBeenCalled();
  });
});
