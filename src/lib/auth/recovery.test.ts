import { describe, expect, it } from "vitest";

import { INVITE_SESSION_MAX_AGE_MS } from "./invite";
import { RESET_SESSION_MAX_AGE_MS, isResetSessionExpired } from "./recovery";

const now = new Date("2026-11-25T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 60 * 60 * 1000;

describe("isResetSessionExpired", () => {
  it("lasts 24 hours, like the invitation", () => {
    expect(RESET_SESSION_MAX_AGE_MS).toBe(24 * HOUR);
    expect(RESET_SESSION_MAX_AGE_MS).toBe(INVITE_SESSION_MAX_AGE_MS);
  });

  it("is valid just before and at 24 hours, expired just after", () => {
    expect(isResetSessionExpired(ago(0), now)).toBe(false);
    expect(isResetSessionExpired(ago(24 * HOUR - 1000), now)).toBe(false);
    expect(isResetSessionExpired(ago(24 * HOUR), now)).toBe(false);
    expect(isResetSessionExpired(ago(24 * HOUR + 1000), now)).toBe(true);
  });

  it("counts a missing moment as expired", () => {
    expect(isResetSessionExpired(null, now)).toBe(true);
  });
});
