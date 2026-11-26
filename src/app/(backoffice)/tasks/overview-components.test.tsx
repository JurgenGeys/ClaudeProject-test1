import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countsPerTab } from "@/lib/tasks/overview-counts";
import type { TaskOverviewRow } from "@/lib/tasks/overview";
import type { TaskOverviewFilters } from "@/lib/validation/task-overview";

import { StatusTabs } from "./status-tabs";
import { TaskFilters } from "./task-filters";
import { TaskList } from "./task-list";
import { TaskPagination } from "./task-pagination";

const ID = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";
const none: TaskOverviewFilters = {
  tab: "active",
  technician: null,
  from: null,
  to: null,
  page: 1,
};

function row(overrides: Partial<TaskOverviewRow> = {}): TaskOverviewRow {
  return {
    id: "t1",
    number: 1042,
    version: "2026-11-23T08:00:00.123456Z",
    scheduledDate: "2026-11-23",
    startTime: "08:00:00",
    customerName: "Bakkerij De Gouden Korst",
    city: "Turnhout",
    workType: "maintenance",
    instructions: "Jaarlijks onderhoud\nFilter vervangen",
    status: "assigned",
    technicianName: "Kevin Wouters",
    pickedUpAt: null,
    completedAt: null,
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
        filters={{ tab: "active", technician: ID, from: "2026-11-01", to: "2026-11-30", page: 1 }}
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

  it("uses text colors that keep 4.5 : 1 on the muted background", () => {
    render(<StatusTabs filters={{ ...none, tab: "open" }} counts={counts} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).not.toMatch(/(^|\s)text-muted-foreground(\s|$)/);
    }
  });

  it("goes back to the first page when a tab is chosen", () => {
    render(<StatusTabs filters={{ ...none, page: 4 }} counts={counts} />);
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "href",
      "/tasks?status=open",
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
        filters={{
          tab: "completed",
          technician: ID,
          from: "2026-11-01",
          to: "2026-11-30",
          page: 1,
        }}
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

describe("TaskFilters when the filters change", () => {
  const technicians = [{ id: ID, fullName: "Kevin Wouters", isActive: true }];

  it("shows the new values, not the old ones (Filters wissen, a tab, the Back button)", () => {
    const filled: TaskOverviewFilters = {
      tab: "active",
      technician: ID,
      from: "2026-11-01",
      to: "2026-11-30",
      page: 1,
    };
    const { rerender } = render(<TaskFilters filters={filled} technicians={technicians} />);
    expect(screen.getByLabelText("Van")).toHaveValue("2026-11-01");

    rerender(<TaskFilters filters={none} technicians={technicians} />);
    expect(screen.getByLabelText("Technieker")).toHaveValue("");
    expect(screen.getByLabelText("Van")).toHaveValue("");
    expect(screen.getByLabelText("Tot en met")).toHaveValue("");

    // And back again, as the Back button does.
    rerender(<TaskFilters filters={filled} technicians={technicians} />);
    expect(screen.getByLabelText("Technieker")).toHaveValue(ID);
    expect(screen.getByLabelText("Tot en met")).toHaveValue("2026-11-30");
  });

  it("keeps what is typed while the filters stay the same", () => {
    const { rerender } = render(<TaskFilters filters={none} technicians={technicians} />);
    // Same filters but another page of the list: the form is not recreated.
    rerender(<TaskFilters filters={{ ...none, page: 2 }} technicians={technicians} />);
    expect(screen.getByLabelText("Van")).toHaveValue("");
  });
});

describe("TaskFilters with a period that ends before it begins", () => {
  const reversed: TaskOverviewFilters = {
    ...none,
    from: "2026-11-30",
    to: "2026-11-01",
  };

  it("shows the message at the end date, linked to the field", () => {
    render(<TaskFilters filters={reversed} technicians={[]} periodReversed />);
    const to = screen.getByLabelText("Tot en met");
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(to).toHaveAccessibleDescription("De einddatum ligt vóór de begindatum.");
    // The typed dates stay in the form.
    expect(screen.getByLabelText("Van")).toHaveValue("2026-11-30");
    expect(to).toHaveValue("2026-11-01");
  });

  it("shows no message for a correct period", () => {
    render(<TaskFilters filters={none} technicians={[]} />);
    expect(screen.getByLabelText("Tot en met")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/einddatum/)).not.toBeInTheDocument();
  });
});

describe("TaskPagination", () => {
  it("shows nothing for one page", () => {
    const { container } = render(<TaskPagination filters={none} pageCount={1} total={12} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the next page on the first page, and keeps every filter", () => {
    render(
      <TaskPagination
        filters={{ tab: "all", technician: ID, from: "2026-11-01", to: null, page: 1 }}
        pageCount={3}
        total={120}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Paginering" });
    expect(nav).toHaveTextContent("Taken 1 tot 50 van 120 (pagina 1 van 3)");
    expect(within(nav).getByRole("link", { name: "Volgende" })).toHaveAttribute(
      "href",
      `/tasks?status=all&technician=${ID}&from=2026-11-01&page=2`,
    );
    expect(within(nav).queryByRole("link", { name: "Vorige" })).not.toBeInTheDocument();
    // No inert "Vorige": a span with aria-disabled and no role is ignored by screen readers.
    expect(within(nav).queryByText("Vorige")).not.toBeInTheDocument();
    expect(nav.querySelector("[aria-disabled]")).toBeNull();
  });

  it("links back to page 1 without ?page= from page 2", () => {
    render(<TaskPagination filters={{ ...none, page: 2 }} pageCount={3} total={120} />);
    expect(screen.getByRole("link", { name: "Vorige" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: "Volgende" })).toHaveAttribute("href", "/tasks?page=3");
  });

  it("has no 'Volgende' link on the last page, and counts the last page correctly", () => {
    render(<TaskPagination filters={{ ...none, page: 3 }} pageCount={3} total={120} />);
    expect(screen.getByRole("navigation", { name: "Paginering" })).toHaveTextContent(
      "Taken 101 tot 120 van 120",
    );
    expect(screen.queryByRole("link", { name: "Volgende" })).not.toBeInTheDocument();
    expect(screen.queryByText("Volgende")).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginering" }).querySelector("[aria-disabled]"),
    ).toBeNull();
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

  it("links the task number, the customer name and the card to the task page", () => {
    render(<TaskList rows={[row()]} />);
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/tasks/1042", "/tasks/1042", "/tasks/1042"]);
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

describe("TaskList of the tab Afgewerkt (completed)", () => {
  // "Now" is fixed: a day in this year has no year.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const done = row({
    status: "completed",
    minutes: 90,
    scheduledDate: "2026-11-20",
    // 23:30 UTC on 23 November is 00:30 on the 24th in Belgium.
    completedAt: new Date("2026-11-23T23:30:00Z"),
  });

  it("shows Afgemeld (in Belgian time) instead of Gepland, and no status column", () => {
    render(<TaskList rows={[done]} completed />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Afgemeld" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Gepland" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toContain("di 24/11");
    expect(table).not.toHaveTextContent("vr 20/11");
  });

  it("shows the same on the phone cards: number and completion day, hours, no status label", () => {
    render(<TaskList rows={[done]} completed />);
    const card = screen.getByRole("list", { name: "Taken" });
    expect(card).toHaveTextContent("#1042 · di 24/11");
    expect(card).toHaveTextContent("1u30");
    expect(card.querySelector("[data-status]")).toBeNull();
  });

  it("shows a dash when there is no completion (not expected on this tab)", () => {
    render(<TaskList rows={[row({ completedAt: null })]} completed />);
    expect(within(screen.getByRole("table")).getAllByRole("cell")[1]).toHaveTextContent("–");
  });

  it("leaves the other tabs as they were: Gepland and Status", () => {
    render(<TaskList rows={[done]} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Gepland" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });
});
