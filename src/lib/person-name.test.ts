import { describe, expect, it } from "vitest";

import { firstName } from "./person-name";

describe("firstName", () => {
  it.each([
    ["Kevin Wouters", "Kevin"],
    ["  Kevin   Wouters  ", "Kevin"],
    ["Kevin", "Kevin"],
    ["Jean-Pierre Van Den Berg", "Jean-Pierre"],
    ["", ""],
  ])("%j gives %j", (input, expected) => {
    expect(firstName(input)).toBe(expected);
  });
});
