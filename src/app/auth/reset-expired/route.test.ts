import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, signOut, deleteRows, cookieStore } = vi.hoisted(() => ({
  deleteRows: vi.fn(),
  getAuthState: vi.fn(),
  signOut: vi.fn(),
  cookieStore: { getAll: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));
vi.mock("@/db/client", () => ({
  getDb: () => ({ delete: () => ({ where: deleteRows }) }),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { GET } from "./route";

const request = () => new NextRequest("http://localhost:3000/auth/reset-expired");
const EXPIRED = "http://localhost:3000/set-password?mode=reset&error=expired";

beforeEach(() => {
  vi.resetAllMocks();
  signOut.mockResolvedValue({ error: null });
  deleteRows.mockResolvedValue(undefined);
  cookieStore.getAll.mockReturnValue([
    { name: "sb-local-auth-token", value: "a" },
    { name: "theme", value: "dark" },
  ]);
});

describe("GET /auth/reset-expired", () => {
  it("ends the expired recovery session and shows the expiry message in mode reset", async () => {
    getAuthState.mockResolvedValue({ status: "reset-expired", sessionId: "s1" });
    const response = await GET(request());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(EXPIRED);
    // The row of this session goes, after the session has ended.
    expect(deleteRows).toHaveBeenCalledTimes(1);
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      deleteRows.mock.invocationCallOrder[0],
    );
  });

  it("still ends the session and shows the message when the row cannot be deleted", async () => {
    getAuthState.mockResolvedValue({ status: "reset-expired", sessionId: "s1" });
    deleteRows.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(request());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(EXPIRED);
  });

  it("removes the session cookies even when the sign-out call fails", async () => {
    getAuthState.mockResolvedValue({ status: "reset-expired", sessionId: "s1" });
    signOut.mockResolvedValue({ error: new Error("auth unreachable") });
    const response = await GET(request());
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-local-auth-token");
    expect(cookieStore.delete).not.toHaveBeenCalledWith("theme");
    expect(response.headers.get("location")).toBe(EXPIRED);
  });

  it.each([
    [
      {
        status: "reset-pending",
        user: { id: "u1", email: "x@y.be", fullName: "X", role: "backoffice" },
      },
    ],
    [{ status: "invite-expired" }],
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
    expect(deleteRows).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
