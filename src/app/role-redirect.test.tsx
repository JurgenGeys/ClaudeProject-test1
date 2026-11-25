import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState } = vi.hoisted(() => ({ getAuthState: vi.fn() }));
const { pathForSignedOutVisitor } = vi.hoisted(() => ({ pathForSignedOutVisitor: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/auth/login-redirect", () => ({ pathForSignedOutVisitor }));
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
  pathForSignedOutVisitor.mockResolvedValue("/login");
});

describe("RoleRedirect", () => {
  it("sends a visitor without a session to the login page", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("clears leftover session cookies before showing the login page", async () => {
    pathForSignedOutVisitor.mockResolvedValue("/auth/clear-session");
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/auth/clear-session");
  });

  it("shows a technical message, without redirecting, when Auth is unreachable", async () => {
    getAuthState.mockResolvedValue({ status: "unavailable" });
    render(await RoleRedirect());
    expect(screen.getByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
  });

  it("sends a technician to Mijn taken", async () => {
    getAuthState.mockResolvedValue(user("technician"));
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/my-tasks");
  });

  it("sends backoffice to the task overview", async () => {
    getAuthState.mockResolvedValue(user("backoffice"));
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/tasks");
  });

  it("sends an invited user without a password to the set password page", async () => {
    getAuthState.mockResolvedValue({
      status: "password-pending",
      user: { id: "u1", email: "x@y.be", fullName: "X" },
    });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/set-password?mode=invite");
  });

  it("sends an expired temporary invitation session to the route that ends it", async () => {
    getAuthState.mockResolvedValue({ status: "invite-expired" });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/auth/invite-expired");
  });

  it("sends a deactivated user to the route that signs them out", async () => {
    getAuthState.mockResolvedValue({ status: "inactive" });
    await expect(RoleRedirect()).rejects.toThrow("NEXT_REDIRECT:/auth/inactive");
  });
});
