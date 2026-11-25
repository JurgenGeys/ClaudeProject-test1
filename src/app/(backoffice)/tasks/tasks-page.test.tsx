import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess } = vi.hoisted(() => ({ checkRoleAccess: vi.fn() }));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));

import TasksPage from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await TasksPage({ searchParams: Promise.resolve(searchParams) } as never));
}

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
});

describe("the tasks page (B1, start of BT-08)", () => {
  it("checks the backoffice role itself", async () => {
    await renderPage();
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
  });

  it("has a 'Nieuwe taak' button that leads to the form", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Taken" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nieuwe taak" })).toHaveAttribute("href", "/tasks/new");
  });

  it("shows no confirmation by default", async () => {
    await renderPage();
    expect(screen.queryByText(/bewaard/)).not.toBeInTheDocument();
  });

  it("confirms a saved task with its number, in a status message", async () => {
    await renderPage({ saved: "1051" });
    expect(screen.getByRole("status")).toHaveTextContent("Taak #1051 bewaard.");
    // One live region, not a status around an alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["abc"],
    ["0"],
    ["-5"],
    ["1e3"],
    ["<b>1</b>"],
    ["1234567890"],
    [["1051", "1052"]],
    [""],
  ])("shows nothing for a saved value that is not a task number (%j)", async (saved) => {
    await renderPage({ saved });
    expect(screen.queryByText(/bewaard/)).not.toBeInTheDocument();
  });

  it.each([["wrong-role"], ["unavailable"]])("renders nothing for access '%s'", async (kind) => {
    checkRoleAccess.mockResolvedValue({ kind, user: { ...sofie, role: "technician" } });
    render((await TasksPage({ searchParams: Promise.resolve({}) } as never)) ?? <></>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
