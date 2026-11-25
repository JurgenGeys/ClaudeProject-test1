import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { taskStatuses } from "@/lib/tasks/types";

import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it.each([
    ["open", "Open", "bg-slate-100"],
    ["assigned", "Toegewezen", "bg-blue-100"],
    ["picked_up", "Opgepikt", "bg-amber-100"],
    ["completed", "Afgewerkt", "bg-green-100"],
    ["invoiced", "Gefactureerd", "bg-violet-100"],
    ["cancelled", "Geannuleerd", "bg-red-100"],
  ] as const)("shows %s as the text %s with its own color", (status, label, color) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveClass(color);
    expect(badge).toHaveAttribute("data-status", status);
  });

  it("gives every status a different color, and always shows text", () => {
    const colors = new Set<string>();
    for (const status of taskStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      const badge = document.querySelector(`[data-status="${status}"]`)!;
      expect(badge.textContent?.trim()).not.toBe("");
      colors.add(badge.className.split(" ").find((c) => /^bg-\w+-100$/.test(c))!);
      unmount();
    }
    expect(colors.size).toBe(taskStatuses.length);
  });

  it("accepts an extra class name", () => {
    render(<StatusBadge status="open" className="ml-2" />);
    expect(screen.getByText("Open")).toHaveClass("ml-2");
  });
});
