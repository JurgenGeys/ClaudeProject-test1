import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const signOutMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut: signOutMock } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { signOut } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  signOutMock.mockResolvedValue({ error: null });
});

describe("signOut", () => {
  it("ends this browser's session and goes to the login page", async () => {
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  });
});
