import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireRole, getCurrentUser } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("./session", async (importOriginal) => ({
  // Keep the real AuthError class: `checkRoleAccess` recognizes errors with `instanceof`.
  ...(await importOriginal<typeof import("./session")>()),
  requireRole,
  getCurrentUser,
}));
// The real session module is loaded for AuthError; keep its dependencies out of the test.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
const { pathForSignedOutVisitor } = vi.hoisted(() => ({ pathForSignedOutVisitor: vi.fn() }));
vi.mock("./login-redirect", () => ({ pathForSignedOutVisitor }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { checkRoleAccess } from "./role-access";
import { AuthError } from "./session";

const technician = { id: "u1", email: "k@x.be", fullName: "Kevin", role: "technician" as const };

beforeEach(() => {
  vi.resetAllMocks();
  pathForSignedOutVisitor.mockResolvedValue("/login");
});

describe("checkRoleAccess", () => {
  it("returns the user when the role matches", async () => {
    requireRole.mockResolvedValue(technician);
    await expect(checkRoleAccess("technician")).resolves.toEqual({
      kind: "allowed",
      user: technician,
    });
    expect(requireRole).toHaveBeenCalledWith("technician");
  });

  it("redirects a visitor without a session to the login page", async () => {
    requireRole.mockRejectedValue(new AuthError("unauthenticated"));
    await expect(checkRoleAccess("technician")).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("clears leftover session cookies first when there are any", async () => {
    pathForSignedOutVisitor.mockResolvedValue("/auth/clear-session");
    requireRole.mockRejectedValue(new AuthError("unauthenticated"));
    await expect(checkRoleAccess("technician")).rejects.toThrow(
      "NEXT_REDIRECT:/auth/clear-session",
    );
  });

  it("reports an unreachable Auth server instead of redirecting (no redirect loop)", async () => {
    requireRole.mockRejectedValue(new AuthError("unavailable"));
    await expect(checkRoleAccess("technician")).resolves.toEqual({ kind: "unavailable" });
  });

  it("redirects a deactivated user to the route that signs them out", async () => {
    requireRole.mockRejectedValue(new AuthError("inactive"));
    await expect(checkRoleAccess("backoffice")).rejects.toThrow("NEXT_REDIRECT:/auth/inactive");
  });

  it("redirects an invited user without a password to the set password page", async () => {
    requireRole.mockRejectedValue(new AuthError("password-pending"));
    await expect(checkRoleAccess("technician")).rejects.toThrow(
      "NEXT_REDIRECT:/set-password?mode=invite",
    );
  });

  it("redirects an expired temporary invitation session to the route that ends it", async () => {
    requireRole.mockRejectedValue(new AuthError("invite-expired"));
    await expect(checkRoleAccess("technician")).rejects.toThrow(
      "NEXT_REDIRECT:/auth/invite-expired",
    );
  });

  it("reports the wrong role together with the user, so the page can point to their own start page", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    getCurrentUser.mockResolvedValue(technician);
    await expect(checkRoleAccess("backoffice")).resolves.toEqual({
      kind: "wrong-role",
      user: technician,
    });
  });

  it("redirects to the login page when the session ended in between", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    getCurrentUser.mockResolvedValue(null);
    await expect(checkRoleAccess("backoffice")).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("does not swallow other errors", async () => {
    requireRole.mockRejectedValue(new Error("database down"));
    await expect(checkRoleAccess("technician")).rejects.toThrow("database down");
  });
});
