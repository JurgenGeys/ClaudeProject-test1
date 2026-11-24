import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle; stub it for unit tests.
vi.mock("server-only", () => ({}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

const findFirst = vi.fn();
vi.mock("@/db/client", () => ({
  getDb: () => ({ query: { profiles: { findFirst } } }),
}));

import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

import type { Profile } from "@/db/schema";

import { AuthError, getAuthState, getCurrentUser, requireRole } from "./session";

const technicianProfile: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "kevin@example.be",
  fullName: "Kevin Wouters",
  role: "technician",
  isActive: true,
  createdAt: new Date("2026-11-24T08:00:00Z"),
  deactivatedAt: null,
};

const backofficeProfile: Profile = {
  ...technicianProfile,
  id: "22222222-2222-4222-8222-222222222222",
  email: "sofie@example.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};

function signedInAs(profile: Profile | undefined) {
  getUser.mockResolvedValue({ data: { user: { id: profile?.id ?? "unknown" } }, error: null });
  findFirst.mockResolvedValue(profile);
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).code;
  }
  return undefined;
}

describe("auth helpers", () => {
  beforeEach(() => {
    getUser.mockReset();
    findFirst.mockReset();
  });

  describe("getCurrentUser", () => {
    it("returns the user with their profile data", async () => {
      signedInAs(technicianProfile);
      expect(await getCurrentUser()).toEqual({
        id: technicianProfile.id,
        email: "kevin@example.be",
        fullName: "Kevin Wouters",
        role: "technician",
      });
    });

    it("returns null without a session", async () => {
      getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
      expect(await getCurrentUser()).toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("returns null when the Auth server returns an error", async () => {
      getUser.mockResolvedValue({ data: { user: { id: "x" } }, error: new Error("boom") });
      expect(await getCurrentUser()).toBeNull();
    });

    it("returns null for a deactivated user", async () => {
      signedInAs({
        ...technicianProfile,
        isActive: false,
        deactivatedAt: new Date("2026-11-25T08:00:00Z"),
      });
      expect(await getCurrentUser()).toBeNull();
    });

    it("returns null for an Auth user without a profile", async () => {
      signedInAs(undefined);
      expect(await getCurrentUser()).toBeNull();
    });
  });

  describe("getAuthState", () => {
    it("tells a missing session apart from a refused account", async () => {
      getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
      expect(await getAuthState()).toEqual({ status: "unauthenticated" });

      signedInAs(undefined);
      expect(await getAuthState()).toEqual({ status: "inactive" });
    });
  });

  describe("getAuthState when Auth is unavailable", () => {
    it.each([
      ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
      ["a server error", new AuthApiError("Internal error", 500, "unexpected_failure")],
      ["rate limiting", new AuthApiError("Too many", 429, "over_request_rate_limit")],
    ])("does not mistake %s for a missing session", async (_name, error) => {
      getUser.mockResolvedValue({ data: { user: null }, error });
      expect(await getAuthState()).toEqual({ status: "unavailable" });
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("still treats a rejected session (client error) as not signed in", async () => {
      getUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError("JWT expired", 401, "bad_jwt"),
      });
      expect(await getAuthState()).toEqual({ status: "unauthenticated" });
    });

    it("makes requireRole throw `unavailable`", async () => {
      getUser.mockResolvedValue({
        data: { user: null },
        error: new AuthRetryableFetchError("fetch failed", 0),
      });
      expect(await codeOf(requireRole("technician"))).toBe("unavailable");
    });
  });

  describe("requireRole", () => {
    it("returns the user when the role matches", async () => {
      signedInAs(backofficeProfile);
      await expect(requireRole("backoffice")).resolves.toMatchObject({ role: "backoffice" });
    });

    it("accepts any of several roles", async () => {
      signedInAs(technicianProfile);
      await expect(requireRole("backoffice", "technician")).resolves.toMatchObject({
        role: "technician",
      });
    });

    it("refuses a technician for a backoffice action", async () => {
      signedInAs(technicianProfile);
      expect(await codeOf(requireRole("backoffice"))).toBe("forbidden");
    });

    it("refuses a backoffice user for a technician action", async () => {
      signedInAs(backofficeProfile);
      expect(await codeOf(requireRole("technician"))).toBe("forbidden");
    });

    it("refuses someone who is not signed in", async () => {
      getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
      expect(await codeOf(requireRole("backoffice", "technician"))).toBe("unauthenticated");
    });

    it("refuses a deactivated user, whatever their role", async () => {
      signedInAs({
        ...backofficeProfile,
        isActive: false,
        deactivatedAt: new Date("2026-11-25T08:00:00Z"),
      });
      expect(await codeOf(requireRole("backoffice"))).toBe("inactive");
    });

    it("refuses an Auth user without a profile", async () => {
      signedInAs(undefined);
      expect(await codeOf(requireRole("technician"))).toBe("inactive");
    });
  });
});
