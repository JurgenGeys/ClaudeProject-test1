import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { markInvoiced } = vi.hoisted(() => ({ markInvoiced: vi.fn() }));
vi.mock("./invoice-actions", () => ({ markInvoiced, unmarkInvoiced: vi.fn() }));

import type { TaskOverviewRow } from "@/lib/tasks/overview";

import { InvoicingNoticeProvider } from "./invoicing-notice";
import { SelectableTaskList } from "./selectable-task-list";

function row(number: number, customerName: string): TaskOverviewRow {
  return {
    id: `id-${number}`,
    number,
    version: `2026-11-25T18:44:00.${String(number).padStart(6, "0")}Z`,
    scheduledDate: "2026-11-23",
    startTime: "08:00:00",
    customerName,
    city: "Turnhout",
    workType: "maintenance",
    instructions: "Jaarlijks onderhoud",
    status: "completed",
    technicianName: "Kevin Wouters",
    pickedUpAt: new Date("2026-11-23T06:48:00Z"),
    completedAt: new Date("2026-11-23T10:47:00Z"),
    minutes: 90,
    corrected: false,
  };
}

const rows = [
  row(1036, "Fam. Hermans"),
  row(1030, "Notariskantoor Lambrechts"),
  row(1027, "Brasserie"),
];

function setUp() {
  return render(
    <InvoicingNoticeProvider>
      <SelectableTaskList rows={rows}>
        <nav aria-label="Paginering">pagina</nav>
      </SelectableTaskList>
    </InvoicingNoticeProvider>,
  );
}

/** Table and cards are both in the DOM (CSS shows one); the table is the first. */
const rowBox = (number: number, customer: string) =>
  screen.getAllByRole("checkbox", { name: `Selecteer taak #${number}, ${customer}` })[0];
const allBox = () =>
  screen.getAllByRole("checkbox", { name: "Alles selecteren op deze pagina" })[0];

beforeEach(() => {
  vi.resetAllMocks();
  // "Now" is fixed: a day in this year has no year.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the selection (B1, tab Afgewerkt)", () => {
  it("has a checkbox per task with the task number and the customer in its name, in the table and on the cards", () => {
    setUp();
    for (const [number, customer] of [
      [1036, "Fam. Hermans"],
      [1030, "Notariskantoor Lambrechts"],
      [1027, "Brasserie"],
    ] as const) {
      expect(
        screen.getAllByRole("checkbox", { name: `Selecteer taak #${number}, ${customer}` }),
      ).toHaveLength(2);
    }
    expect(
      screen.getAllByRole("checkbox", { name: "Alles selecteren op deze pagina" }),
    ).toHaveLength(2);
  });

  it("puts every checkbox in a target of 44 by 44 px", () => {
    setUp();
    for (const box of screen.getAllByRole("checkbox")) {
      const label = box.closest("label");
      expect(label).toHaveClass("size-11");
    }
  });

  it("shows no bar, but a live region that is already there, until something is ticked", () => {
    const { container } = setUp();
    expect(
      screen.queryByRole("button", { name: "Markeer als gefactureerd" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it("announces the number in a live region that holds only the count, not the whole bar", () => {
    const { container } = setUp();
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).toBeEmptyDOMElement();
    fireEvent.click(rowBox(1036, "Fam. Hermans"));
    expect(live).toHaveTextContent(/^1 taak geselecteerd$/);
    expect(live).not.toContainElement(
      screen.getByRole("button", { name: "Markeer als gefactureerd" }),
    );
    fireEvent.click(rowBox(1030, "Notariskantoor Lambrechts"));
    expect(live).toHaveTextContent(/^2 taken geselecteerd$/);
    fireEvent.click(rowBox(1036, "Fam. Hermans"));
    fireEvent.click(rowBox(1030, "Notariskantoor Lambrechts"));
    expect(live).toBeEmptyDOMElement();
    expect(
      screen.queryByRole("button", { name: "Markeer als gefactureerd" }),
    ).not.toBeInTheDocument();
  });

  it("is the list for invoicing: the column Afgemeld with the day of completing, and no status", () => {
    setUp();
    const table = screen.getByRole("table", { name: "Taken" });
    expect(within(table).getByRole("columnheader", { name: "Afgemeld" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Gepland" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    // Belgian time: 10:47 UTC on 23 November is the same day; the planned day is not shown.
    expect(within(table).getAllByText(/ma 23\/11/)).toHaveLength(3);
    expect(table).not.toHaveTextContent("Afgewerkt");
  });

  it("selects and clears all with 'Alles selecteren', which is half checked for a part", () => {
    setUp();
    fireEvent.click(rowBox(1036, "Fam. Hermans"));
    expect(allBox()).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(allBox());
    expect(screen.getByText("3 taken geselecteerd")).toBeInTheDocument();
    expect(allBox()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(allBox());
    expect(screen.queryByText(/geselecteerd/)).not.toBeInTheDocument();
  });

  it("keeps the pagination under the list", () => {
    setUp();
    expect(screen.getByRole("navigation", { name: "Paginering" })).toBeInTheDocument();
  });
});

describe("the confirmation and the result", () => {
  async function openDialog() {
    fireEvent.click(rowBox(1036, "Fam. Hermans"));
    fireEvent.click(rowBox(1030, "Notariskantoor Lambrechts"));
    fireEvent.click(screen.getByRole("button", { name: "Markeer als gefactureerd" }));
    return screen.findByRole("dialog", { name: "2 taken markeren als gefactureerd?" });
  }

  it("asks the question of the design", async () => {
    setUp();
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(
      "De uren van deze taken kunnen daarna niet meer gewijzigd worden.",
    );
  });

  it("sends only the ticked tasks with their versions, and where the request comes from", async () => {
    markInvoiced.mockResolvedValue({ ok: true, success: "ok", problems: [] });
    setUp();
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    const data = markInvoiced.mock.calls[0][1] as FormData;
    expect(data.getAll("task")).toEqual([
      "1036@2026-11-25T18:44:00.001036Z",
      "1030@2026-11-25T18:44:00.001030Z",
    ]);
    expect(data.get("view")).toBe("list");
    expect([...data.keys()].sort()).toEqual(["task", "task", "view"]);
  });

  it("closes, clears the selection and confirms above the list", async () => {
    markInvoiced.mockResolvedValue({
      ok: true,
      success: '2 taken gemarkeerd als gefactureerd. Je vindt ze terug onder "Gefactureerd".',
      problems: [],
    });
    setUp();
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/geselecteerd/)).not.toBeInTheDocument();
    const status = screen.getAllByRole("status")[0];
    expect(status).toHaveTextContent("2 taken gemarkeerd als gefactureerd.");
    expect(status.querySelector('[data-slot="alert"]')).toHaveClass("bg-green-50");
  });

  it("shows what was left out in amber next to the confirmation", async () => {
    markInvoiced.mockResolvedValue({
      ok: true,
      success: "Taak gemarkeerd als gefactureerd.",
      problems: ["1 taak was al gefactureerd."],
    });
    setUp();
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    const status = screen.getAllByRole("status")[0];
    expect(status).toHaveTextContent("Taak gemarkeerd als gefactureerd.");
    expect(status).toHaveTextContent("1 taak was al gefactureerd.");
    expect(status.querySelector('[data-slot="alert"]')).toHaveClass("bg-amber-50");
  });

  it("says that nothing was marked when nothing was", async () => {
    markInvoiced.mockResolvedValue({
      ok: false,
      kind: "nothing",
      problems: [
        "2 taken zijn intussen gewijzigd en zijn niet gemarkeerd. Controleer de taken en probeer opnieuw.",
      ],
      reload: false,
    });
    setUp();
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    const status = screen.getAllByRole("status")[0];
    expect(status).toHaveTextContent("Er is niets gemarkeerd.");
    expect(status).toHaveTextContent("2 taken zijn intussen gewijzigd");
  });

  it("keeps the dialog and the selection after a technical problem, and shows the message in it", async () => {
    markInvoiced.mockResolvedValue({
      ok: false,
      kind: "error",
      message: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    setUp();
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Dat is niet gelukt.");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annuleren" }));
    expect(screen.getByText("2 taken geselecteerd")).toBeInTheDocument();
  });

  it("says '1 taak' in the singular", async () => {
    setUp();
    fireEvent.click(rowBox(1036, "Fam. Hermans"));
    fireEvent.click(screen.getByRole("button", { name: "Markeer als gefactureerd" }));
    expect(
      await screen.findByRole("dialog", { name: "1 taak markeren als gefactureerd?" }),
    ).toBeInTheDocument();
  });
});
