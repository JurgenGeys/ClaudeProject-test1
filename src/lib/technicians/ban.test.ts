import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AUTH_BAN_TIMEOUT_MS, AuthTimeoutError, BanFailedError, changeAuthBan } from "./ban";

const updateUserById = vi.fn();
const admin = { auth: { admin: { updateUserById } } } as unknown as Parameters<
  typeof changeAuthBan
>[0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("changeAuthBan", () => {
  it("passes the duration to Auth and clears its timer", async () => {
    updateUserById.mockResolvedValue({ error: null });
    await changeAuthBan(admin, "u1", "87600h");
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith("u1", { ban_duration: "87600h" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws BanFailedError with the Auth error", async () => {
    const authError = new Error("nope");
    updateUserById.mockResolvedValue({ error: authError });
    const failure = await changeAuthBan(admin, "u1", "none").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BanFailedError);
    expect((failure as BanFailedError).cause).toBe(authError);
  });

  it("throws AuthTimeoutError when Auth does not answer in time", async () => {
    updateUserById.mockReturnValue(new Promise(() => {}));
    const result = changeAuthBan(admin, "u1", "none").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(AUTH_BAN_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(AuthTimeoutError);
  });
});
