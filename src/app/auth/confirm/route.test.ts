import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { verifyOtp, signOut, findProfile } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  findProfile: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp, signOut } }),
}));
vi.mock("@/db/client", () => ({
  getDb: () => ({ query: { profiles: { findFirst: findProfile } } }),
}));

import { GET } from "./route";

const TOKEN = "pkce-or-hashed-token-1234567890abcdef";
const get = (query: string, origin = "http://localhost:3000") =>
  GET(new NextRequest(`${origin}/auth/confirm${query}`));

const INVALID = "/set-password?mode=invite&error=link";
const UNAVAILABLE = "/set-password?mode=invite&error=unavailable";

const pendingTechnician = {
  id: "u1",
  role: "technician",
  isActive: true,
  invitePending: true,
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  signOut.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  findProfile.mockResolvedValue(pendingTechnician);
});

describe("GET /auth/confirm: a good invitation", () => {
  it("verifies the token as an invitation and sends the visitor to set a password", async () => {
    const response = await get(`?token_hash=${TOKEN}&type=invite`);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: TOKEN });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/set-password?mode=invite");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("is never cached and does not put the token in the redirect", async () => {
    const response = await get(`?token_hash=${TOKEN}&type=invite`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).not.toContain(TOKEN);
  });

  it("redirects with a relative address, so it can only stay on the host that received the request", async () => {
    const response = await get(`?token_hash=${TOKEN}&type=invite`, "https://planning.frisair.be");
    expect(response.headers.get("location")).toBe("/set-password?mode=invite");
  });

  it("ignores a `next` or `redirect_to` parameter: the destination is fixed", async () => {
    const response = await get(
      `?token_hash=${TOKEN}&type=invite&next=https://evil.example&redirect_to=https://evil.example`,
    );
    expect(response.headers.get("location")).toBe("/set-password?mode=invite");
  });
});

describe("GET /auth/confirm: an invalid link", () => {
  it.each([
    ["no parameters", ""],
    ["no token", "?type=invite"],
    ["an empty token", "?token_hash=&type=invite"],
    ["no type", `?token_hash=${TOKEN}`],
    // Recovery arrives in BT-06b; until then it is not accepted here.
    ["another type", `?token_hash=${TOKEN}&type=recovery`],
    ["a very long token", `?token_hash=${"a".repeat(513)}&type=invite`],
  ])("sends %s to the message, without asking Auth", async (_name, query) => {
    const response = await get(query);
    expect(response.headers.get("location")).toBe(INVALID);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("shows the message for an expired or used token", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"),
    });
    const response = await get(`?token_hash=${TOKEN}&type=invite`);
    expect(response.headers.get("location")).toBe(INVALID);
    expect(response.headers.get("location")).not.toContain(TOKEN);
  });

  it.each([
    ["no profile", undefined],
    ["a deactivated profile", { ...pendingTechnician, isActive: false }],
    ["a profile that already has a password", { ...pendingTechnician, invitePending: false }],
    ["a backoffice profile", { ...pendingTechnician, role: "backoffice" }],
  ])("signs out again and shows the message for %s", async (_name, profile) => {
    findProfile.mockResolvedValue(profile);
    const response = await get(`?token_hash=${TOKEN}&type=invite`);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(INVALID);
  });
});

describe("GET /auth/confirm: when something is unreachable", () => {
  it.each([
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a server error", new AuthApiError("Internal error", 500, "unexpected_failure")],
    ["rate limiting", new AuthApiError("Too many", 429, "over_request_rate_limit")],
  ])("does not call the link invalid after %s", async (_name, error) => {
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error });
    const response = await get(`?token_hash=${TOKEN}&type=invite`);
    expect(response.headers.get("location")).toBe(UNAVAILABLE);
  });

  it("signs out and shows the technical message when the database fails, and logs no token", async () => {
    findProfile.mockRejectedValue(new Error(`db down while handling ${TOKEN}`));
    const response = await get(`?token_hash=${TOKEN}&type=invite`);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(UNAVAILABLE);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(TOKEN);
  });
});
