import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SiteUrlError, getInviteRedirectUrl, getSiteUrl } from "./site-url";

describe("getSiteUrl", () => {
  it("returns the origin of the setting, without a trailing slash or path", () => {
    expect(getSiteUrl({ SITE_URL: "https://planning.frisair.be" })).toBe(
      "https://planning.frisair.be",
    );
    expect(getSiteUrl({ SITE_URL: " https://planning.frisair.be/ " })).toBe(
      "https://planning.frisair.be",
    );
    expect(getSiteUrl({ SITE_URL: "https://planning.frisair.be/app?x=1#y" })).toBe(
      "https://planning.frisair.be",
    );
  });

  it("accepts plain http for a local address only", () => {
    expect(getSiteUrl({ SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(getSiteUrl({ SITE_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    expect(() => getSiteUrl({ SITE_URL: "http://planning.frisair.be" })).toThrow(SiteUrlError);
  });

  it.each([
    undefined,
    "",
    "   ",
    "planning.frisair.be",
    "ftp://planning.frisair.be",
    "javascript:1",
  ])("refuses %j", (value) => {
    expect(() => getSiteUrl({ SITE_URL: value })).toThrow(SiteUrlError);
  });

  it("refuses an address with a user name or password", () => {
    expect(() => getSiteUrl({ SITE_URL: "https://user:pw@planning.frisair.be" })).toThrow(
      SiteUrlError,
    );
  });

  it("names the setting in the error and never echoes the value", () => {
    expect(() => getSiteUrl({ SITE_URL: "ftp://secret.example" })).toThrow(/SITE_URL/);
    try {
      getSiteUrl({ SITE_URL: "ftp://secret.example" });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret.example");
    }
  });

  it("reads the process environment by default", () => {
    process.env.SITE_URL = "http://localhost:3000";
    try {
      expect(getSiteUrl()).toBe("http://localhost:3000");
    } finally {
      delete process.env.SITE_URL;
    }
  });
});

describe("getInviteRedirectUrl", () => {
  it("points to /auth/confirm on the configured site", () => {
    expect(getInviteRedirectUrl({ SITE_URL: "https://planning.frisair.be/" })).toBe(
      "https://planning.frisair.be/auth/confirm",
    );
  });
});
