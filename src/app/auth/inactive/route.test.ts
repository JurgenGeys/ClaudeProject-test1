import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, signOut } = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

import { GET } from "./route";

const request = () => new NextRequest("http://localhost:3000/auth/inactive");

beforeEach(() => {
  vi.resetAllMocks();
  signOut.mockResolvedValue({ error: null });
});

describe("GET /auth/inactive", () => {
  it("signs a deactivated user out and shows the login page with the reason", async () => {
    getAuthState.mockResolvedValue({ status: "inactive" });
    const response = await GET(request());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?reason=disabled");
  });

  it("does not sign out an active user (a crafted link cannot end somebody's session)", async () => {
    getAuthState.mockResolvedValue({
      status: "authenticated",
      user: { id: "u1", email: "x@y.be", fullName: "X", role: "technician" },
    });
    const response = await GET(request());
    expect(signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("does nothing for a visitor without a session", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    const response = await GET(request());
    expect(signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
