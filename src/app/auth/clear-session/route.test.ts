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

const request = () => new NextRequest("http://localhost:3000/auth/clear-session");

beforeEach(() => {
  vi.resetAllMocks();
  signOut.mockResolvedValue({ error: null });
  cookieStore.getAll.mockReturnValue([
    { name: "sb-local-auth-token.0", value: "a" },
    { name: "sb-local-auth-token.1", value: "b" },
    { name: "theme", value: "dark" },
  ]);
});

describe("GET /auth/clear-session", () => {
  it("removes the session cookies of a visitor the Auth server does not know", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    const response = await GET(request());
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token.0");
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token.1");
    expect(cookieStore.delete).not.toHaveBeenCalledWith("theme");
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("still removes the cookies when signing out fails", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    signOut.mockRejectedValue(new Error("offline"));
    const response = await GET(request());
    expect(cookieStore.delete).toHaveBeenCalledTimes(2);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("leaves a valid session alone", async () => {
    getAuthState.mockResolvedValue({
      status: "authenticated",
      user: { id: "u1", email: "x@y.be", fullName: "X", role: "technician" },
    });
    const response = await GET(request());
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("leaves the cookies alone when Auth is unreachable (an outage must not sign everybody out)", async () => {
    getAuthState.mockResolvedValue({ status: "unavailable" });
    const response = await GET(request());
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
