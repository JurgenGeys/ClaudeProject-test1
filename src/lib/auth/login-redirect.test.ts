import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAll } = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll }) }));

import { pathForSignedOutVisitor } from "./login-redirect";

beforeEach(() => {
  getAll.mockReset();
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
