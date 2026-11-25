import { describe, expect, it } from "vitest";

import { INVITE_SESSION_MAX_AGE_MS, isInviteSessionExpired } from "./invite";

const verified = new Date("2026-11-25T10:00:00Z");
const after = (ms: number) => new Date(verified.getTime() + ms);

describe("isInviteSessionExpired", () => {
  it("is 24 hours", () => {
    expect(INVITE_SESSION_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("is valid right after verifying and up to exactly 24 hours", () => {
    expect(isInviteSessionExpired(verified, verified)).toBe(false);
    expect(isInviteSessionExpired(verified, after(INVITE_SESSION_MAX_AGE_MS))).toBe(false);
  });

  it("is expired after more than 24 hours", () => {
    expect(isInviteSessionExpired(verified, after(INVITE_SESSION_MAX_AGE_MS + 1))).toBe(true);
  });

  it("counts a missing verification moment as expired", () => {
    expect(isInviteSessionExpired(null, verified)).toBe(true);
  });

  it("does not expire a moment in the future (clock differences)", () => {
    expect(isInviteSessionExpired(after(1000), verified)).toBe(false);
  });
});
