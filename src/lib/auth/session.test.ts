import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle; stub it for unit tests.
vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const getClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser, getClaims } }),
}));

const findFirst = vi.fn();
const selectRecovery = vi.fn();
vi.mock("@/db/client", () => ({
  getDb: () => ({
    query: { profiles: { findFirst } },
    select: () => ({ from: () => ({ where: selectRecovery }) }),
  }),
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
  invitePending: false,
  inviteVerifiedAt: null,
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

const SESSION_ID = "5e5510a9-0000-4000-8000-000000000001";
const OTHER_SESSION_ID = "5e5510a9-0000-4000-8000-000000000002";

/** The session of this request, as `getClaims` reports it (or null: it cannot be read). */
function sessionIs(sessionId: string | null) {
  getClaims.mockResolvedValue({
    data: { claims: sessionId ? { session_id: sessionId } : {} },
    error: null,
  });
}

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
    getClaims.mockReset();
    selectRecovery.mockReset();
    selectRecovery.mockResolvedValue([]);
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

    it("reports an invited user without a password as `password-pending`", async () => {
      signedInAs({ ...technicianProfile, invitePending: true, inviteVerifiedAt: new Date() });
      expect(await getAuthState()).toEqual({
        status: "password-pending",
        user: {
          id: technicianProfile.id,
          email: technicianProfile.email,
          fullName: technicianProfile.fullName,
        },
      });
    });

    it("treats a pending invitation verified more than 24 hours ago as expired", async () => {
      signedInAs({
        ...technicianProfile,
        invitePending: true,
        inviteVerifiedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 60_000),
      });
      expect(await getAuthState()).toEqual({ status: "invite-expired" });
    });

    it("keeps a pending invitation valid just inside the 24 hours", async () => {
      signedInAs({
        ...technicianProfile,
        invitePending: true,
        inviteVerifiedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 60_000),
      });
      expect(await getAuthState()).toMatchObject({ status: "password-pending" });
    });

    it("treats a pending profile without a recorded verification as expired", async () => {
      signedInAs({ ...technicianProfile, invitePending: true, inviteVerifiedAt: null });
      expect(await getAuthState()).toEqual({ status: "invite-expired" });
    });

    it("lets a deactivated profile win over a pending invitation", async () => {
      signedInAs({
        ...technicianProfile,
        invitePending: true,
        isActive: false,
        deactivatedAt: new Date("2026-11-25T08:00:00Z"),
      });
      expect(await getAuthState()).toEqual({ status: "inactive" });
    });
  });

  describe("getAuthState with a recovery session (wachtwoord vergeten)", () => {
    const HOUR = 60 * 60 * 1000;
    /** The user has these recovery sessions (rows of `recovery_sessions`). */
    const recoveryRows = (...rows: { sessionId: string; verifiedAt: Date }[]) =>
      selectRecovery.mockResolvedValue(rows);
    const own = (verifiedAt: Date) => ({ sessionId: SESSION_ID, verifiedAt });

    it.each([
      ["backoffice", backofficeProfile],
      ["technician", technicianProfile],
    ])("restricts the recovery session of an active %s", async (_name, profile) => {
      signedInAs(profile);
      recoveryRows(own(new Date()));
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toEqual({
        status: "reset-pending",
        sessionId: SESSION_ID,
        user: {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          role: profile.role,
        },
      });
    });

    it("does not restrict another session of the same user (a phone that was already signed in)", async () => {
      signedInAs(backofficeProfile);
      recoveryRows({ sessionId: OTHER_SESSION_ID, verifiedAt: new Date() });
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toMatchObject({ status: "authenticated" });
    });

    it("restricts each of two recovery sessions on its own", async () => {
      signedInAs(backofficeProfile);
      recoveryRows(own(new Date()), { sessionId: OTHER_SESSION_ID, verifiedAt: new Date() });
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toMatchObject({
        status: "reset-pending",
        sessionId: SESSION_ID,
      });
      sessionIs(OTHER_SESSION_ID);
      expect(await getAuthState()).toMatchObject({
        status: "reset-pending",
        sessionId: OTHER_SESSION_ID,
      });
    });

    it("expires the recovery session after 24 hours, and not before", async () => {
      signedInAs(backofficeProfile);
      sessionIs(SESSION_ID);
      recoveryRows(own(new Date(Date.now() - 24 * HOUR + 60_000)));
      expect(await getAuthState()).toMatchObject({ status: "reset-pending" });

      recoveryRows(own(new Date(Date.now() - 24 * HOUR - 60_000)));
      expect(await getAuthState()).toEqual({ status: "reset-expired", sessionId: SESSION_ID });
    });

    it("does not look at the session at all when nobody is resetting", async () => {
      signedInAs(backofficeProfile);
      expect(await getAuthState()).toMatchObject({ status: "authenticated" });
      expect(getClaims).not.toHaveBeenCalled();
    });

    it("does not hand out a normal session when it cannot tell which session this is", async () => {
      signedInAs(backofficeProfile);
      recoveryRows(own(new Date()));
      sessionIs(null);
      expect(await getAuthState()).toEqual({ status: "unavailable" });

      getClaims.mockResolvedValue({ data: null, error: new Error("no session") });
      expect(await getAuthState()).toEqual({ status: "unavailable" });
    });

    it("lets a deactivated profile win over a recovery session", async () => {
      signedInAs({
        ...backofficeProfile,
        isActive: false,
        deactivatedAt: new Date("2026-11-25T08:00:00Z"),
      });
      recoveryRows(own(new Date()));
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toEqual({ status: "inactive" });
    });

    it("lets a pending invitation win over a recovery session", async () => {
      signedInAs({ ...technicianProfile, invitePending: true, inviteVerifiedAt: new Date() });
      recoveryRows(own(new Date()));
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toMatchObject({ status: "password-pending" });
    });

    it("makes requireRole refuse the recovery session for every role", async () => {
      signedInAs(backofficeProfile);
      recoveryRows(own(new Date()));
      sessionIs(SESSION_ID);
      expect(await codeOf(requireRole("backoffice"))).toBe("reset-pending");
      expect(await codeOf(requireRole("technician", "backoffice"))).toBe("reset-pending");
      expect(await getCurrentUser()).toBeNull();

      recoveryRows(own(new Date(Date.now() - 25 * HOUR)));
      expect(await codeOf(requireRole("backoffice"))).toBe("reset-expired");
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

    it("treats a blocked Auth account (`user_banned`) as `inactive`, so the user is told so", async () => {
      getUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError("User is banned", 403, "user_banned"),
      });
      expect(await getAuthState()).toEqual({ status: "inactive" });
      expect(findFirst).not.toHaveBeenCalled();
      expect(await getCurrentUser()).toBeNull();
      expect(await codeOf(requireRole("technician"))).toBe("inactive");
    });

    it("does not treat other refusals (403 without `user_banned`) as `inactive`", async () => {
      getUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError("Forbidden", 403, "not_admin"),
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

    it("refuses an invited user who has not chosen a password yet, whatever the role", async () => {
      signedInAs({ ...technicianProfile, invitePending: true, inviteVerifiedAt: new Date() });
      expect(await codeOf(requireRole("technician"))).toBe("password-pending");
      expect(await codeOf(requireRole("backoffice"))).toBe("password-pending");
    });

    it("refuses an invited user whose temporary session has expired", async () => {
      signedInAs({ ...technicianProfile, invitePending: true, inviteVerifiedAt: null });
      expect(await codeOf(requireRole("technician"))).toBe("invite-expired");
    });

    it("makes getCurrentUser return null for an invited user without a password", async () => {
      signedInAs({ ...technicianProfile, invitePending: true, inviteVerifiedAt: new Date() });
      expect(await getCurrentUser()).toBeNull();
    });
  });
});
