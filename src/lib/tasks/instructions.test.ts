import { describe, expect, it } from "vitest";

import { firstLine } from "./instructions";

describe("firstLine", () => {
  it.each([
    ["Jaarlijks onderhoud\nFilter vervangen", "Jaarlijks onderhoud"],
    ["\r\n  \n  Eerste echte regel  \r\nTweede", "Eerste echte regel"],
    ["één regel", "één regel"],
    ["   ", ""],
  ])("takes the first non-empty line of %j", (text, expected) => {
    expect(firstLine(text)).toBe(expected);
  });
});
