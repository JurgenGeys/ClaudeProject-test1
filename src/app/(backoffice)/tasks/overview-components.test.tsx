import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countsPerTab } from "@/lib/tasks/overview-counts";
import type { TaskOverviewRow } from "@/lib/tasks/overview";
import type { TaskOverviewFilters } from "@/lib/validation/task-overview";

import { StatusTabs } from "./status-tabs";
import { TaskFilters } from "./task-filters";
import { firstLine, TaskList } from "./task-list";

const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";
const none: TaskOverviewFilters = { tab: "active", technician: null, from: null, to: null };

function row(overrides: Partial<TaskOverviewRow> = {}): TaskOverviewRow {
  return {
    id: "t1",
    number: 1042,
    scheduledDate: "2026-11-23",
    startTime: "08:00:00",
    customerName: "Bakkerij De Gouden Korst",
    city: "Turnhout",
    workType: "maintenance",
    instructions: "Jaarlijks onderhoud\nFilter vervangen",
    status: "assigned",
    technicianName: "Kevin Wouters",
    pickedUpAt: null,
    minutes: null,
    corrected: false,
    ...overrides,
  };
}

describe("StatusTabs", () => {
  const counts = countsPerTab({ open: 2, assigned: 6, picked_up: 2, completed: 6, cancelled: 1 });

  it("shows the eight tabs in the order of the design, each with its count", () => {
    render(<StatusTabs filters={none} counts={counts} />);
    const links = within(screen.getByRole("navigation", { name: "Status" })).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Actief16 taken",
      "Open2 taken",
      "Toegewezen6 taken",
      "Opgepikt2 taken",
      "Afgewerkt6 taken",
      "Gefactureerd0 taken",
      "Geannuleerd1 taak",
      "Alle17 taken",
    ]);
  });

  it("marks only the current tab with aria-current", () => {
    render(<StatusTabs filters={{ ...none, tab: "cancelled" }} counts={counts} />);
    const current = screen.getAllByRole("link").filter((l) => l.hasAttribute("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-current", "page");
    expect(current[0]).toHaveTextContent("Geannuleerd");
  });

  it("links to the tab and keeps the technician and period", () => {
    render(
      <StatusTabs
        filters={{ tab: "active", technician: ID, from: "2026-11-01", to: "2026-11-30" }}
        counts={counts}
      />,
    );
    expect(screen.getByRole("link", { name: /^Actief/ })).toHaveAttribute(
      "href",
      `/tasks?technician=${ID}&from=2026-11-01&to=2026-11-30`,
    );
    expect(screen.getByRole("link", { name: /^Opgepikt/ })).toHaveAttribute(
      "href",
      `/tasks?status=picked_up&technician=${ID}&from=2026-11-01&to=2026-11-30`,
    );
  });

  it("is reached with the keyboard: every tab is a plain focusable link", () => {
    render(<StatusTabs filters={none} counts={counts} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href");
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }
  });
});

describe("TaskFilters", () => {
  const technicians = [
    { id: ID, fullName: "Kevin Wouters", isActive: true },
    { id: "b2", fullName: "Tom Hendrickx", isActive: false },
  ];

  it("is a GET form to /tasks with labelled fields", () => {
    render(<TaskFilters filters={none} technicians={technicians} />);
    const form = screen.getByRole("form", { name: "Filters" });
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/tasks");
    expect(screen.getByLabelText("Technieker")).toHaveValue("");
    expect(screen.getByLabelText("Van")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Tot en met")).toHaveAttribute("type", "date");
    expect(screen.getByRole("button", { name: "Filteren" })).toHaveAttribute("type", "submit");
  });

  it("lists switched-off technicians too, marked as such", () => {
    render(<TaskFilters filters={none} technicians={technicians} />);
    const options = within(screen.getByLabelText("Technieker")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Alle techniekers",
      "Kevin Wouters",
      "Tom Hendrickx (uitgeschakeld)",
    ]);
  });

  it("shows the active filters and offers to clear them", () => {
    render(
      <TaskFilters
        filters={{ tab: "completed", technician: ID, from: "2026-11-01", to: "2026-11-30" }}
        technicians={technicians}
      />,
    );
    expect(screen.getByLabelText("Technieker")).toHaveValue(ID);
    expect(screen.getByLabelText("Van")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Tot en met")).toHaveValue("2026-11-30");
    // Clearing keeps the tab.
    expect(screen.getByRole("link", { name: "Filters wissen" })).toHaveAttribute(
      "href",
      "/tasks?status=completed",
    );
  });

  it("keeps the tab in a hidden field, except for the default tab", () => {
    const { container, rerender } = render(
      <TaskFilters filters={{ ...none, tab: "open" }} technicians={technicians} />,
    );
    expect(container.querySelector('input[name="status"]')).toHaveValue("open");
    rerender(<TaskFilters filters={none} technicians={technicians} />);
    expect(container.querySelector('input[name="status"]')).toBeNull();
  });

  it("has no 'Filters wissen' without a technician or period filter", () => {
    render(<TaskFilters filters={{ ...none, tab: "open" }} technicians={technicians} />);
    expect(screen.queryByRole("link", { name: "Filters wissen" })).not.toBeInTheDocument();
  });
});

describe("firstLine", () => {
  it.each([
    ["Jaarlijks onderhoud\nFilter vervangen", "Jaarlijks onderhoud"],
    ["\r\n  \n  Eerste echte regel  \r\nTweede", "Eerste echte regel"],
    ["één regel", "één regel"],
    ["   ", ""],
  ])("takes the first non-empty line of %j", (text, expected) => {
    expect(firstLine(text)).toBe(expected);
  });
});

describe("TaskList", () => {
  it("is a table with column headers, in the order of the design", () => {
    render(<TaskList rows={[row()]} />);
    const table = screen.getByRole("table", { name: "Taken" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Nr.", "Gepland", "Klant", "Soort", "Instructies", "Technieker", "Status", "Uren"]);
  });

  it("shows number, date and start time, customer and city, kind of work and first line", () => {
    render(<TaskList rows={[row()]} />);
    const cells = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(cells).toHaveTextContent("#1042");
    expect(cells).toHaveTextContent("ma 23/11/2026 08:00");
    expect(cells).toHaveTextContent("Bakkerij De Gouden Korst");
    expect(cells).toHaveTextContent("Turnhout");
    expect(cells).toHaveTextContent("Onderhoud");
    expect(cells).toHaveTextContent("Jaarlijks onderhoud");
    expect(cells).not.toHaveTextContent("Filter vervangen");
    expect(cells).toHaveTextContent("Kevin Wouters");
    expect(cells).toHaveTextContent("Toegewezen");
  });

  it("links the task number and the card to the task page", () => {
    render(<TaskList rows={[row()]} />);
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/tasks/1042", "/tasks/1042"]);
  });

  it("says 'Nog niet toegewezen' for a task without technician", () => {
    render(<TaskList rows={[row({ status: "open", technicianName: null })]} />);
    expect(within(screen.getByRole("table")).getByText("Nog niet toegewezen")).toBeInTheDocument();
  });

  it("shows since when a picked-up task is picked up, in Belgian time", () => {
    render(
      <TaskList
        rows={[row({ status: "picked_up", pickedUpAt: new Date("2026-11-23T06:48:00Z") })]}
      />,
    );
    expect(within(screen.getByRole("table")).getByText("sinds 07:48")).toBeInTheDocument();
  });

  it("shows no 'sinds' for other statuses", () => {
    render(<TaskList rows={[row({ status: "completed", minutes: 90 })]} />);
    expect(screen.queryByText(/sinds/)).not.toBeInTheDocument();
  });

  it("shows the hours and a label when they are corrected", () => {
    render(<TaskList rows={[row({ status: "completed", minutes: 150, corrected: true })]} />);
    const table = within(screen.getByRole("table"));
    expect(table.getByText(/2u30/)).toBeInTheDocument();
    expect(table.getByText("gecorrigeerd")).toBeInTheDocument();
  });

  it("shows no 'gecorrigeerd' for hours that were not corrected", () => {
    render(<TaskList rows={[row({ status: "completed", minutes: 90 })]} />);
    expect(screen.getAllByText(/1u30/).length).toBeGreaterThan(0);
    expect(screen.queryByText("gecorrigeerd")).not.toBeInTheDocument();
  });

  it("shows the status in text for every task, never only in color", () => {
    render(
      <TaskList
        rows={[
          row({ id: "a", status: "cancelled" }),
          row({ id: "b", status: "invoiced", minutes: 60 }),
        ]}
      />,
    );
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Geannuleerd")).toBeInTheDocument();
    expect(table.getByText("Gefactureerd")).toBeInTheDocument();
  });

  it("also renders a list of cards for a phone, with the same tasks", () => {
    render(<TaskList rows={[row(), row({ id: "t2", number: 1043 })]} />);
    const list = screen.getByRole("list", { name: "Taken" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByRole("link")[0]).toHaveAttribute("href", "/tasks/1042");
    expect(list).toHaveTextContent("Bakkerij De Gouden Korst");
  });

  it("shows the table only from laptop width and the cards below it", () => {
    render(<TaskList rows={[row()]} />);
    expect(screen.getByRole("table").closest(".hidden")).toHaveClass("md:block");
    expect(screen.getByRole("list", { name: "Taken" })).toHaveClass("md:hidden");
  });

  it("keeps the HTML of customer names and instructions as text", () => {
    render(
      <TaskList
        rows={[row({ customerName: "<img src=x onerror=alert(1)>", instructions: "<b>vet</b>" })]}
      />,
    );
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getAllByText("<img src=x onerror=alert(1)>").length).toBeGreaterThan(0);
  });
});
