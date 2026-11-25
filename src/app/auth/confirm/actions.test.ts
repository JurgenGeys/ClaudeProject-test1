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

import { confirmInvite } from "./actions";

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
) => confirmInvite(form(fields));

const INVALID = "NEXT_REDIRECT:/set-password?mode=invite&error=link";
const UNAVAILABLE = "NEXT_REDIRECT:/set-password?mode=invite&error=unavailable";

const pendingTechnician = { id: "u1", role: "technician", isActive: true, invitePending: true };

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  signOut.mockResolvedValue({ error: null });
  cookieStore.getAll.mockReturnValue([{ name: "sb-local-auth-token", value: "a" }]);
  verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  findProfile.mockResolvedValue(pendingTechnician);
});

describe("confirmInvite: a good link", () => {
  it.each(["invite", "recovery"] as const)(
    "verifies a %s token, records the moment and sends the visitor to set a password",
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

describe("confirmInvite: an invalid link", () => {
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
    ["a backoffice profile", { ...pendingTechnician, role: "backoffice" }],
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

describe("confirmInvite: when something is unreachable", () => {
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
