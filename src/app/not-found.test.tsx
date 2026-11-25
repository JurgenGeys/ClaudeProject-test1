import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

describe("NotFound", () => {
  it("says in Dutch that the page does not exist and links to the start page", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Deze pagina bestaat (nog) niet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar de startpagina" })).toHaveAttribute("href", "/");
  });
});
