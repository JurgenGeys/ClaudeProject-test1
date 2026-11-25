import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/tasks" } }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
// The real button posts to a Server Action, which cannot run in a unit test.
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button>Uitloggen</button>,
}));

import { AppHeader } from "./app-header";

beforeEach(() => {
  pathname.current = "/tasks";
});

describe("AppHeader for the backoffice", () => {
  it("shows the company name, the main menu, the user name and Uitloggen", () => {
    render(<AppHeader role="backoffice" userName="Sofie Peeters" companyName="FrisAir" />);
    expect(screen.getByRole("link", { name: "FrisAir" })).toHaveAttribute("href", "/tasks");
    const nav = screen.getByRole("navigation", { name: "Hoofdmenu" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Taken", "/tasks"],
      ["Klanten", "/customers"],
      ["Techniekers", "/technicians"],
    ]);
    expect(screen.getByText("Sofie Peeters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uitloggen" })).toBeInTheDocument();
  });

  it("marks the current page, also on a sub page", () => {
    pathname.current = "/tasks/1042";
    render(<AppHeader role="backoffice" userName="Sofie Peeters" />);
    expect(screen.getByRole("link", { name: "Taken" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Klanten" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Techniekers" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark a page whose path only starts with the same letters", () => {
    pathname.current = "/tasks-archive";
    render(<AppHeader role="backoffice" userName="Sofie Peeters" />);
    expect(screen.getByRole("link", { name: "Taken" })).not.toHaveAttribute("aria-current");
  });

  it("shows the word Planning when there is no company name", () => {
    render(<AppHeader role="backoffice" userName="Sofie Peeters" />);
    expect(screen.getByRole("link", { name: "Planning" })).toBeInTheDocument();
  });

  it("treats an empty company name as no company name", () => {
    render(<AppHeader role="backoffice" userName="Sofie Peeters" companyName="" />);
    expect(screen.getByRole("link", { name: "Planning" })).toBeInTheDocument();
  });
});

describe("AppHeader for a technician", () => {
  it("shows the company name, the user name and Uitloggen, without a menu", () => {
    pathname.current = "/my-tasks";
    render(<AppHeader role="technician" userName="Kevin Wouters" companyName="FrisAir" />);
    expect(screen.getByRole("link", { name: "FrisAir" })).toHaveAttribute("href", "/my-tasks");
    expect(screen.getByText("Kevin Wouters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uitloggen" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows the word Planning when there is no company name", () => {
    render(<AppHeader role="technician" userName="Kevin Wouters" />);
    expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("href", "/my-tasks");
  });

  it("is one banner landmark, so a screen reader user can find it", () => {
    render(<AppHeader role="technician" userName="Kevin Wouters" />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
