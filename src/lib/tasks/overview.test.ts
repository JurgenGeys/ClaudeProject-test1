import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
const getDb = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));

import { getTaskOverview } from "./overview";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getTaskOverview", () => {
  it("checks the backoffice role first and reads nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(getTaskOverview({})).rejects.toThrow("forbidden");
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(getDb).not.toHaveBeenCalled();
  });
});
