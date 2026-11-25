import { describe, expect, it } from "vitest";

import { sessionIdFromAccessToken } from "./session-id";

function tokenWith(claims: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256" })}.${encode(claims)}.signature`;
}

describe("sessionIdFromAccessToken", () => {
  it("reads the session id claim", () => {
    expect(sessionIdFromAccessToken(tokenWith({ sub: "u1", session_id: "s-1" }))).toBe("s-1");
  });

  it.each([
    ["a token without the claim", tokenWith({ sub: "u1" })],
    ["an empty claim", tokenWith({ session_id: "" })],
    ["a claim that is no string", tokenWith({ session_id: 12 })],
    ["a payload that is no object", tokenWith("text")],
    ["a payload that is no JSON", "a.%%%.c"],
    ["a string without dots", "nonsense"],
    ["an empty string", ""],
    ["nothing", undefined],
    ["null", null],
  ])("returns null for %s", (_name, token) => {
    expect(sessionIdFromAccessToken(token)).toBeNull();
  });
});
