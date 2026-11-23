import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
  });

  it("lets the last conflicting Tailwind class win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("ignores falsy values", () => {
    const isActive = false;
    expect(cn("p-2", isActive && "bg-primary", undefined, null)).toBe("p-2");
  });
});
