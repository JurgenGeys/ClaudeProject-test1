import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess } = vi.hoisted(() => ({ checkRoleAccess: vi.fn() }));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
const { getTaskOverview } = vi.hoisted(() => ({ getTaskOverview: vi.fn() }));
vi.mock("@/lib/tasks/overview", () => ({ getTaskOverview }));

import { countsPerTab } from "@/lib/tasks/overview-counts";
import type { TaskOverview, TaskOverviewRow } from "@/lib/tasks/overview";

import TasksPage from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };
const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";

const aRow: TaskOverviewRow = {
  id: "t1",
  number: 1042,
  scheduledDate: "2026-11-23",
  startTime: "08:00:00",
  customerName: "Bakkerij De Gouden Korst",
  city: "Turnhout",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud",
  status: "assigned",
  technicianName: "Kevin Wouters",
  pickedUpAt: null,
  minutes: null,
  corrected: false,
};

function overview(overrides: Partial<TaskOverview> = {}): TaskOverview {
  return {
    filters: { tab: "active", technician: null, from: null, to: null, page: 1 },
    technicians: [{ id: ID, fullName: "Kevin Wouters", isActive: true }],
    counts: countsPerTab({ assigned: 1 }),
    rows: [aRow],
    page: 1,
    pageCount: 1,
    periodReversed: false,
    hasAnyTask: true,
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await TasksPage({ searchParams: Promise.resolve(searchParams) } as never));
}

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  getTaskOverview.mockResolvedValue(overview());
});

describe("the tasks page (B1)", () => {
  it("checks the backoffice role itself", async () => {
    await renderPage();
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
  });

  it("passes the search parameters on to be parsed", async () => {
    const params = { status: "open", technician: ID };
    await renderPage(params);
    expect(getTaskOverview).toHaveBeenCalledWith(params);
  });

  it("has a 'Nieuwe taak' button that leads to the form", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Taken" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nieuwe taak" })).toHaveAttribute("href", "/tasks/new");
  });

  it("shows the tabs, the filters and the tasks", async () => {
    await renderPage();
    expect(screen.getByRole("navigation", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Taken" })).toHaveTextContent("#1042");
  });

  it("uses the filters that the overview applied, not the ones in the URL", async () => {
    // A technician that does not exist is dropped by the query; the select must say so.
    getTaskOverview.mockResolvedValue(
      overview({ filters: { tab: "active", technician: null, from: null, to: null, page: 1 } }),
    );
    await renderPage({ technician: "6f1c1c7e-4f55-4c3b-9d33-000000000000" });
    expect(screen.getByLabelText("Technieker")).toHaveValue("");
  });

  describe("without any task", () => {
    beforeEach(() => {
      getTaskOverview.mockResolvedValue(overview({ rows: [], hasAnyTask: false }));
    });

    it("shows the empty state with one 'Nieuwe taak' link and no tabs or filters", async () => {
      await renderPage();
      expect(screen.getByText("Er zijn nog geen taken.")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Nieuwe taak" })).toHaveLength(1);
      expect(screen.queryByRole("navigation", { name: "Status" })).not.toBeInTheDocument();
      expect(screen.queryByRole("form", { name: "Filters" })).not.toBeInTheDocument();
    });
  });

  describe("with tasks but no result", () => {
    it("explains that no task matches the filter and offers to clear it", async () => {
      getTaskOverview.mockResolvedValue(
        overview({
          rows: [],
          filters: { tab: "open", technician: ID, from: null, to: null, page: 1 },
        }),
      );
      await renderPage();
      expect(screen.getByText("Geen taken gevonden voor deze filter.")).toBeInTheDocument();
      const clear = screen
        .getAllByRole("link", { name: "Filters wissen" })
        .map((link) => link.getAttribute("href"));
      // The link in the filter bar and the button in the empty state, both keep the tab.
      expect(clear).toEqual(["/tasks?status=open", "/tasks?status=open"]);
    });

    it("sends an empty tab without technician or period back to the default view", async () => {
      getTaskOverview.mockResolvedValue(
        overview({
          rows: [],
          filters: { tab: "invoiced", technician: null, from: null, to: null, page: 1 },
        }),
      );
      await renderPage();
      expect(screen.getByText("Geen taken gevonden voor deze filter.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Filters wissen" })).toHaveAttribute(
        "href",
        "/tasks",
      );
    });

    it("has its own message for an empty tab Geannuleerd", async () => {
      getTaskOverview.mockResolvedValue(
        overview({
          rows: [],
          filters: { tab: "cancelled", technician: null, from: null, to: null, page: 1 },
        }),
      );
      await renderPage();
      expect(screen.getByText("Er zijn geen geannuleerde taken.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Filters wissen" })).not.toBeInTheDocument();
    });

    it("uses the filter message for Geannuleerd when a filter is set", async () => {
      getTaskOverview.mockResolvedValue(
        overview({
          rows: [],
          filters: { tab: "cancelled", technician: ID, from: null, to: null, page: 1 },
        }),
      );
      await renderPage();
      expect(screen.getByText("Geen taken gevonden voor deze filter.")).toBeInTheDocument();
    });
  });

  it("shows the pagination when there is more than one page", async () => {
    getTaskOverview.mockResolvedValue(
      overview({
        page: 2,
        pageCount: 3,
        counts: countsPerTab({ assigned: 120 }),
        filters: { tab: "active", technician: null, from: null, to: null, page: 2 },
      }),
    );
    await renderPage({ page: "2" });
    const nav = screen.getByRole("navigation", { name: "Paginering" });
    expect(nav).toHaveTextContent("pagina 2 van 3");
    expect(within(nav).getByRole("link", { name: "Volgende" })).toHaveAttribute(
      "href",
      "/tasks?page=3",
    );
  });

  it("shows no pagination for one page", async () => {
    await renderPage();
    expect(screen.queryByRole("navigation", { name: "Paginering" })).not.toBeInTheDocument();
  });

  it("shows the message at the end date when the period is reversed", async () => {
    getTaskOverview.mockResolvedValue(
      overview({
        periodReversed: true,
        filters: { tab: "active", technician: null, from: "2026-11-30", to: "2026-11-01", page: 1 },
      }),
    );
    await renderPage();
    expect(screen.getByLabelText("Tot en met")).toHaveAccessibleDescription(
      "De einddatum ligt vóór de begindatum.",
    );
    // The list is still shown: the impossible period is not applied.
    expect(screen.getByRole("table", { name: "Taken" })).toBeInTheDocument();
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

  it("keeps the confirmation next to a filter", async () => {
    await renderPage({ saved: "1051", technician: ID });
    expect(screen.getByRole("status")).toHaveTextContent("Taak #1051 bewaard.");
    expect(
      within(screen.getByRole("navigation", { name: "Status" })).getAllByRole("link"),
    ).toHaveLength(8);
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
    expect(getTaskOverview).not.toHaveBeenCalled();
  });
});
