import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState } = vi.hoisted(() => ({ getAuthState: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { RoleRedirect } from "./role-redirect";

const user = (role: "technician" | "backoffice") => ({
  status: "authenticated" as const,
  user: { id: "u1", email: "x@y.be", fullName: "X", role },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("RoleRedirect", () => {
  it("sends a visitor without a session to the login page", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("sends a technician to Mijn taken", async () => {
    getAuthState.mockResolvedValue(user("technician"));
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/my-tasks");
  });

  it("sends backoffice to the task overview", async () => {
    getAuthState.mockResolvedValue(user("backoffice"));
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/tasks");
  });

  it("sends a deactivated user to the route that signs them out", async () => {
    getAuthState.mockResolvedValue({ status: "inactive" });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/auth/inactive");
  });
});
