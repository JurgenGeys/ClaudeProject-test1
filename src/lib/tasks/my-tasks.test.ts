import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
const getDb = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));

import { getMyTaskDetail } from "./detail";
import { getMyTasks } from "./my-tasks";

const NOW = new Date("2026-11-23T09:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getMyTasks", () => {
  it("checks the technician role first and reads nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(getMyTasks("todo", NOW)).rejects.toThrow("forbidden");
    expect(requireRole).toHaveBeenCalledWith("technician");
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("getMyTaskDetail", () => {
  it("checks the technician role first and reads nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(getMyTaskDetail(1042)).rejects.toThrow("forbidden");
    expect(requireRole).toHaveBeenCalledWith("technician");
    expect(getDb).not.toHaveBeenCalled();
  });
});
