import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// RoleRedirect is an async Server Component that reads the session; it has its own test.
vi.mock("./role-redirect", () => ({
  RoleRedirect: () => <p>Doorsturen volgens rol</p>,
}));

import Home from "./page";

describe("Home page", () => {
  it("only hands the visitor on to the start page of their role", () => {
    render(<Home />);
    expect(screen.getByText("Doorsturen volgens rol")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
