import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server bundle; stub it for unit tests.
vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const getSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser, getSession } }),
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
  invitePending: false,
  inviteVerifiedAt: null,
  recoverySessionId: null,
  recoveryVerifiedAt: null,
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

/** The cookie session of this request: an access token with this `session_id` claim. */
function sessionIs(sessionId: string | null) {
  const claims = Buffer.from(JSON.stringify(sessionId ? { session_id: sessionId } : {})).toString(
    "base64url",
  );
  getSession.mockResolvedValue({
    data: { session: { access_token: `x.${claims}.y` } },
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
    getSession.mockReset();
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
    const recovering = (verifiedAt: Date | null, profile: Profile = backofficeProfile) => ({
      ...profile,
      recoverySessionId: SESSION_ID,
      recoveryVerifiedAt: verifiedAt,
    });
    const HOUR = 60 * 60 * 1000;

    it.each([
      ["backoffice", backofficeProfile],
      ["technician", technicianProfile],
    ])("restricts the recovery session of an active %s", async (_name, profile) => {
      signedInAs(recovering(new Date(), profile));
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toEqual({
        status: "reset-pending",
        user: {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          role: profile.role,
        },
      });
    });

    it("does not restrict another session of the same user (a phone that was already signed in)", async () => {
      signedInAs(recovering(new Date()));
      sessionIs(OTHER_SESSION_ID);
      expect(await getAuthState()).toMatchObject({ status: "authenticated" });
    });

    it("expires the recovery session after 24 hours, and not before", async () => {
      signedInAs(recovering(new Date(Date.now() - 24 * HOUR + 60_000)));
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toMatchObject({ status: "reset-pending" });

      signedInAs(recovering(new Date(Date.now() - 24 * HOUR - 60_000)));
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toEqual({ status: "reset-expired" });
    });

    it("does not look at the session at all when nobody is resetting", async () => {
      signedInAs(backofficeProfile);
      expect(await getAuthState()).toMatchObject({ status: "authenticated" });
      expect(getSession).not.toHaveBeenCalled();
    });

    it("does not hand out a normal session when it cannot tell which session this is", async () => {
      signedInAs(recovering(new Date()));
      sessionIs(null);
      expect(await getAuthState()).toEqual({ status: "unavailable" });

      getSession.mockResolvedValue({ data: { session: null }, error: new Error("no session") });
      expect(await getAuthState()).toEqual({ status: "unavailable" });
    });

    it("lets a deactivated profile win over a recovery session", async () => {
      signedInAs({
        ...recovering(new Date()),
        isActive: false,
        deactivatedAt: new Date("2026-11-25T08:00:00Z"),
      });
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toEqual({ status: "inactive" });
    });

    it("lets a pending invitation win over a recovery marker", async () => {
      signedInAs({
        ...recovering(new Date(), technicianProfile),
        invitePending: true,
        inviteVerifiedAt: new Date(),
      });
      sessionIs(SESSION_ID);
      expect(await getAuthState()).toMatchObject({ status: "password-pending" });
    });

    it("makes requireRole refuse the recovery session for every role", async () => {
      signedInAs(recovering(new Date()));
      sessionIs(SESSION_ID);
      expect(await codeOf(requireRole("backoffice"))).toBe("reset-pending");
      expect(await codeOf(requireRole("technician", "backoffice"))).toBe("reset-pending");
      expect(await getCurrentUser()).toBeNull();

      signedInAs(recovering(new Date(Date.now() - 25 * HOUR)));
      sessionIs(SESSION_ID);
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
