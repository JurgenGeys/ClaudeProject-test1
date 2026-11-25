import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, signOut, cookieStore } = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  signOut: vi.fn(),
  cookieStore: { getAll: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { GET } from "./route";

const request = () => new NextRequest("http://localhost:3000/auth/invite-expired");

beforeEach(() => {
  vi.resetAllMocks();
  signOut.mockResolvedValue({ error: null });
  cookieStore.getAll.mockReturnValue([
    { name: "sb-local-auth-token", value: "a" },
    { name: "theme", value: "dark" },
  ]);
});

describe("GET /auth/invite-expired", () => {
  it("ends the expired session and shows the expiry message on the set password page", async () => {
    getAuthState.mockResolvedValue({ status: "invite-expired" });
    const response = await GET(request());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/set-password?mode=invite&error=expired",
    );
  });

  it("removes the session cookies even when the sign-out call fails", async () => {
    getAuthState.mockResolvedValue({ status: "invite-expired" });
    signOut.mockResolvedValue({ error: new Error("auth unreachable") });
    const response = await GET(request());
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token");
    expect(cookieStore.delete).not.toHaveBeenCalledWith("theme");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/set-password?mode=invite&error=expired",
    );
  });

  it.each([
    [{ status: "password-pending", user: { id: "u1", email: "x@y.be", fullName: "X" } }],
    [
      {
        status: "authenticated",
        user: { id: "u1", email: "x@y.be", fullName: "X", role: "technician" },
      },
    ],
    [{ status: "unauthenticated" }],
  ])("does not sign out anybody whose session is fine (%j)", async (state) => {
    getAuthState.mockResolvedValue(state);
    const response = await GET(request());
    expect(signOut).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
