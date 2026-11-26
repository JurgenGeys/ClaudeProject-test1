import { describe, expect, it } from "vitest";

import { telHref } from "./phone";

describe("telHref", () => {
  it("keeps the digits and a leading plus and drops spaces and punctuation", () => {
    expect(telHref("014 41 22 87")).toBe("tel:014412287");
    expect(telHref("+32 (0)14/41.22.87")).toBe("tel:+32014412287");
  });
});
