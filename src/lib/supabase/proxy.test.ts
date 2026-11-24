import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void;

const getClaims = vi.fn();
let setAll: SetAll | undefined;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: SetAll } }) => {
    setAll = options.cookies.setAll;
    return { auth: { getClaims } };
  },
}));

import { updateSession } from "./proxy";

const request = (path: string, method = "GET") =>
  new NextRequest(`http://localhost:3000${path}`, { method });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  getClaims.mockReset();
  setAll = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  it("redirects a visitor without a session to the login page", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no session") });
    const response = await updateSession(request("/tasks?status=open"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets a visitor without a session open the login page", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const response = await updateSession(request("/login"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("sends a signed-in user from the login page to the root", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    const response = await updateSession(request("/login"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("lets a signed-in user through to a protected page", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    const response = await updateSession(request("/tasks"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("writes a refreshed session to the response, also when it redirects", async () => {
    getClaims.mockImplementation(async () => {
      setAll?.([{ name: "sb-session", value: "new-token", options: { path: "/" } }], {
        "Cache-Control": "private, no-store",
      });
      return { data: { claims: { sub: "u1" } }, error: null };
    });

    const passed = await updateSession(request("/tasks"));
    expect(passed.cookies.get("sb-session")?.value).toBe("new-token");
    expect(passed.headers.get("Cache-Control")).toBe("private, no-store");

    const redirected = await updateSession(request("/login"));
    expect(redirected.headers.get("location")).toBe("http://localhost:3000/");
    expect(redirected.cookies.get("sb-session")?.value).toBe("new-token");
    expect(redirected.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
