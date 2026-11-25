import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { verifyOtp, signOut, findProfile, set, cookieStore } = vi.hoisted(() => ({
  cookieStore: { getAll: vi.fn(), delete: vi.fn() },
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  findProfile: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp, signOut } }),
}));
vi.mock("@/db/client", () => ({
  getDb: () => ({
    query: { profiles: { findFirst: findProfile } },
    update: () => ({
      set: (...args: unknown[]) => {
        set(...args);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { confirmLink } from "./actions";

const TOKEN = "hashed-token-1234567890abcdef";
const form = (fields: Record<string, string | undefined>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(key, value);
    }
  }
  return data;
};
const press = (
  fields: Record<string, string | undefined> = { token_hash: TOKEN, type: "invite" },
) => confirmLink(form(fields));

const INVALID = "NEXT_REDIRECT:/set-password?mode=invite&error=link";
const UNAVAILABLE = "NEXT_REDIRECT:/set-password?mode=invite&error=unavailable";

const pendingTechnician = { id: "u1", role: "technician", isActive: true, invitePending: true };
const activeBackoffice = { id: "u1", role: "backoffice", isActive: true, invitePending: false };
const activeTechnician = { id: "u1", role: "technician", isActive: true, invitePending: false };

// An access token as Auth issues it: only the `session_id` claim matters here.
const SESSION_ID = "5e5510a9-0000-4000-8000-000000000001";
const ACCESS_TOKEN = `x.${Buffer.from(JSON.stringify({ session_id: SESSION_ID })).toString("base64url")}.y`;
const verified = {
  data: { user: { id: "u1" }, session: { access_token: ACCESS_TOKEN } },
  error: null,
};

const RESET_INVALID = "NEXT_REDIRECT:/set-password?mode=reset&error=link";
const RESET_UNAVAILABLE = "NEXT_REDIRECT:/set-password?mode=reset&error=unavailable";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  signOut.mockResolvedValue({ error: null });
  cookieStore.getAll.mockReturnValue([{ name: "sb-local-auth-token", value: "a" }]);
  verifyOtp.mockResolvedValue(verified);
  findProfile.mockResolvedValue(pendingTechnician);
});

describe("confirmLink: a good invitation link", () => {
  it.each(["invite", "recovery"] as const)(
    "verifies a %s token of a pending technician, records the moment and sends the visitor to set a password",
    async (type) => {
      await expect(press({ token_hash: TOKEN, type })).rejects.toThrow(
        "NEXT_REDIRECT:/set-password?mode=invite",
      );
      expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: TOKEN });
      // The moment of verification comes from the database clock, not from the visitor.
      expect(set).toHaveBeenCalledWith({ inviteVerifiedAt: expect.anything() });
      expect(signOut).not.toHaveBeenCalled();
    },
  );

  it("does not tie an invitation session to a recovery session", async () => {
    await expect(press()).rejects.toThrow("NEXT_REDIRECT:/set-password?mode=invite");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ inviteVerifiedAt: expect.anything() });
  });

  it("never puts the token in a redirect or in the logs", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError(`bad token ${TOKEN}`, 403, "otp_expired"),
    });
    await expect(press()).rejects.toThrow(INVALID);
    await expect(press()).rejects.not.toThrow(TOKEN);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(TOKEN);
  });
});

describe("confirmLink: an invalid link", () => {
  it.each([
    ["nothing", {}],
    ["no token", { type: "invite" }],
    ["an empty token", { token_hash: "", type: "invite" }],
    ["no type", { token_hash: TOKEN }],
    // Only `invite` and `recovery` exist; a magic link or sign-up token is not an invitation.
    ["another type", { token_hash: TOKEN, type: "magiclink" }],
    ["a very long token", { token_hash: "a".repeat(513), type: "invite" }],
  ])("refuses %s without asking Auth", async (_name, fields) => {
    await expect(press(fields)).rejects.toThrow(INVALID);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("shows the message for an expired or used token and records nothing", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"),
    });
    await expect(press()).rejects.toThrow(INVALID);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ["no profile", undefined],
    ["a deactivated profile", { ...pendingTechnician, isActive: false }],
    ["a profile that already has a password", { ...pendingTechnician, invitePending: false }],
    ["a pending profile that is not a technician", { ...pendingTechnician, role: "backoffice" }],
  ])("signs out again and shows the message for %s", async (_name, profile) => {
    findProfile.mockResolvedValue(profile);
    await expect(press()).rejects.toThrow(INVALID);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token");
    expect(set).not.toHaveBeenCalled();
  });

  it("removes the session cookies even when the sign-out call fails", async () => {
    findProfile.mockResolvedValue(undefined);
    signOut.mockResolvedValue({ error: new Error("auth unreachable") });
    await expect(press()).rejects.toThrow(INVALID);
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token");
  });
});

describe("confirmLink: when something is unreachable", () => {
  it.each([
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a server error", new AuthApiError("Internal error", 500, "unexpected_failure")],
    ["rate limiting", new AuthApiError("Too many", 429, "over_request_rate_limit")],
  ])("does not call the link invalid after %s", async (_name, error) => {
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error });
    await expect(press()).rejects.toThrow(UNAVAILABLE);
  });

  it("signs out and shows the technical message when the database fails, and logs no token", async () => {
    findProfile.mockRejectedValue(new Error(`db down while handling ${TOKEN}`));
    await expect(press()).rejects.toThrow(UNAVAILABLE);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(TOKEN);
  });
});

describe("confirmLink: a recovery link of somebody who has a password (wachtwoord vergeten)", () => {
  const recover = () => press({ token_hash: TOKEN, type: "recovery" });

  it.each([
    ["an active backoffice user", activeBackoffice],
    ["an active technician", activeTechnician],
  ])(
    "ties the new session of %s to the reset and sends them to G2 in mode reset",
    async (_n, profile) => {
      findProfile.mockResolvedValue(profile);
      await expect(recover()).rejects.toThrow("NEXT_REDIRECT:/set-password?mode=reset");
      expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: TOKEN });
      // This very session, and the database clock for the 24 hours; the invitation fields stay alone.
      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({
        recoverySessionId: SESSION_ID,
        recoveryVerifiedAt: expect.anything(),
      });
      expect(signOut).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["no profile", undefined],
    ["a deactivated backoffice user", { ...activeBackoffice, isActive: false }],
    ["a deactivated technician", { ...activeTechnician, isActive: false }],
  ])("signs out again and shows the general message for %s", async (_name, profile) => {
    findProfile.mockResolvedValue(profile);
    await expect(recover()).rejects.toThrow(RESET_INVALID);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token");
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses a session whose token has no session id: it could not be restricted", async () => {
    findProfile.mockResolvedValue(activeBackoffice);
    verifyOtp.mockResolvedValue({
      data: { user: { id: "u1" }, session: { access_token: "not-a-token" } },
      error: null,
    });
    await expect(recover()).rejects.toThrow(RESET_INVALID);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(set).not.toHaveBeenCalled();
  });

  it("shows the reset message for an expired or used token and records nothing", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"),
    });
    await expect(recover()).rejects.toThrow(RESET_INVALID);
    expect(set).not.toHaveBeenCalled();
  });

  it("does not call the link invalid when Auth is unreachable", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    await expect(recover()).rejects.toThrow(RESET_UNAVAILABLE);
  });

  it("signs out when the database fails, and logs no token", async () => {
    findProfile.mockResolvedValue(activeBackoffice);
    findProfile.mockRejectedValue(new Error(`db down while handling ${TOKEN}`));
    await expect(recover()).rejects.toThrow(RESET_UNAVAILABLE);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(TOKEN);
  });

  it("never lets an invitation link restrict (or reuse) the session of somebody with a password", async () => {
    findProfile.mockResolvedValue(activeBackoffice);
    await expect(press({ token_hash: TOKEN, type: "invite" })).rejects.toThrow(INVALID);
    expect(set).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("uses the reset wording for a recovery link without a token", async () => {
    await expect(press({ type: "recovery" })).rejects.toThrow(RESET_INVALID);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
