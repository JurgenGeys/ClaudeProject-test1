import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
const getDb = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));

import { listAssignableTechnicians, listTechnicians } from "./queries";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listTechnicians", () => {
  it("checks the backoffice role first and does not read anything for anyone else", async () => {
    requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(listTechnicians()).rejects.toThrow("forbidden");
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("listAssignableTechnicians", () => {
  it("checks the backoffice role first and does not read anything for anyone else", async () => {
    requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(listAssignableTechnicians()).rejects.toThrow("forbidden");
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(getDb).not.toHaveBeenCalled();
  });
});
