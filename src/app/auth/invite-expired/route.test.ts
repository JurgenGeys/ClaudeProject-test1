import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, signOut } = vi.hoisted(() => ({ getAuthState: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

import { GET } from "./route";

const request = () => new NextRequest("http://localhost:3000/auth/invite-expired");

beforeEach(() => {
  vi.resetAllMocks();
  signOut.mockResolvedValue({ error: null });
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
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
