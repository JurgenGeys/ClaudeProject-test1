import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAll, deleteCookie } = vi.hoisted(() => ({ getAll: vi.fn(), deleteCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll, delete: deleteCookie }) }));

import { endLocalSession, pathForSignedOutVisitor } from "./login-redirect";

beforeEach(() => {
  getAll.mockReset();
  deleteCookie.mockReset();
});

describe("pathForSignedOutVisitor", () => {
  it("goes straight to the login page without session cookies", async () => {
    getAll.mockReturnValue([{ name: "theme", value: "dark" }]);
    expect(await pathForSignedOutVisitor()).toBe("/login");
  });

  it("clears leftover session cookies first", async () => {
    getAll.mockReturnValue([{ name: "sb-local-auth-token", value: "x" }]);
    expect(await pathForSignedOutVisitor()).toBe("/auth/clear-session");
  });
});

describe("endLocalSession", () => {
  const cookiesPresent = [
    { name: "sb-local-auth-token.0", value: "a" },
    { name: "sb-local-auth-token.1", value: "b" },
    { name: "theme", value: "dark" },
  ];

  function expectOnlySessionCookiesDeleted() {
    expect(deleteCookie).toHaveBeenCalledWith("sb-local-auth-token.0");
    expect(deleteCookie).toHaveBeenCalledWith("sb-local-auth-token.1");
    expect(deleteCookie).not.toHaveBeenCalledWith("theme");
  }

  it("signs out locally and removes the session cookies", async () => {
    getAll.mockReturnValue(cookiesPresent);
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await endLocalSession({ auth: { signOut } });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expectOnlySessionCookiesDeleted();
  });

  it("still removes the cookies when signOut returns an error", async () => {
    getAll.mockReturnValue(cookiesPresent);
    const signOut = vi.fn().mockResolvedValue({ error: new Error("auth unreachable") });
    await endLocalSession({ auth: { signOut } });
    expectOnlySessionCookiesDeleted();
  });

  it("still removes the cookies when signOut throws", async () => {
    getAll.mockReturnValue(cookiesPresent);
    const signOut = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(endLocalSession({ auth: { signOut } })).resolves.toBeUndefined();
    expectOnlySessionCookiesDeleted();
  });
});
