import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkTypeLabel } from "./work-type-label";

describe("WorkTypeLabel", () => {
  it.each([
    ["inspection", "Nazicht"],
    ["maintenance", "Onderhoud"],
    ["repair", "Herstelling"],
  ] as const)("shows %s as %s", (workType, label) => {
    render(<WorkTypeLabel workType={workType} />);
    expect(screen.getByText(label)).toHaveAttribute("data-work-type", workType);
  });

  it("accepts a class name", () => {
    render(<WorkTypeLabel workType="repair" className="text-sm" />);
    expect(screen.getByText("Herstelling")).toHaveClass("text-sm");
  });
});
