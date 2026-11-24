import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotForYou } from "./not-for-you";

describe("NotForYou", () => {
  it("sends a technician back to Mijn taken", () => {
    render(<NotForYou role="technician" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Deze pagina is niet voor jou bedoeld" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar mijn taken" })).toHaveAttribute(
      "href",
      "/my-tasks",
    );
  });

  it("sends backoffice back to the task overview", () => {
    render(<NotForYou role="backoffice" />);
    expect(screen.getByRole("link", { name: "Naar de taken" })).toHaveAttribute("href", "/tasks");
  });
});
