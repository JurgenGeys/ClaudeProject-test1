import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { markInvoiced, unmarkInvoiced } = vi.hoisted(() => ({
  markInvoiced: vi.fn(),
  unmarkInvoiced: vi.fn(),
}));
vi.mock("./invoice-actions", () => ({ markInvoiced, unmarkInvoiced }));

import { TaskInvoiceActions } from "./task-invoice-actions";

const V = "2026-11-25T18:44:00.123456Z";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("TaskInvoiceActions (B3)", () => {
  it.each(["open", "assigned", "picked_up", "cancelled"] as const)(
    "shows nothing for a task that is %s",
    (status) => {
      const { container } = render(
        <TaskInvoiceActions number={1043} version={V} status={status} />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("offers 'Markeer als gefactureerd' for an Afgewerkt task, with the confirmation of the design", async () => {
    render(<TaskInvoiceActions number={1043} version={V} status="completed" />);
    expect(
      screen.queryByRole("button", { name: "Markering ongedaan maken" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Markeer als gefactureerd" }));
    const dialog = await screen.findByRole("dialog", { name: "Markeren als gefactureerd?" });
    expect(dialog).toHaveTextContent(
      "De uren van deze taak kunnen daarna niet meer gewijzigd worden.",
    );
  });

  it("sends the task with its version and that it comes from the task page", async () => {
    markInvoiced.mockResolvedValue(null);
    render(<TaskInvoiceActions number={1043} version={V} status="completed" />);
    fireEvent.click(screen.getByRole("button", { name: "Markeer als gefactureerd" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    const data = markInvoiced.mock.calls[0][1] as FormData;
    expect(data.getAll("task")).toEqual([`1043@${V}`]);
    expect(data.get("view")).toBe("task");
  });

  it("shows the message and a reload button when the task changed meanwhile", async () => {
    markInvoiced.mockResolvedValue({
      ok: false,
      kind: "nothing",
      problems: ["Deze taak is al gefactureerd."],
      reload: true,
    });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<TaskInvoiceActions number={1043} version={V} status="completed" />);
    fireEvent.click(screen.getByRole("button", { name: "Markeer als gefactureerd" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Markeer als gefactureerd" }));
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Deze taak is al gefactureerd.");
    fireEvent.click(screen.getByRole("button", { name: "Pagina herladen" }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("offers 'Markering ongedaan maken' for a Gefactureerd task, with the text of the design", async () => {
    render(<TaskInvoiceActions number={1043} version={V} status="invoiced" />);
    expect(
      screen.queryByRole("button", { name: "Markeer als gefactureerd" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Markering ongedaan maken" }));
    const dialog = await screen.findByRole("dialog", { name: "Markering ongedaan maken?" });
    expect(dialog).toHaveTextContent(
      "De taak staat dan terug op Afgewerkt en de uren kunnen weer gewijzigd worden.",
    );
  });

  it("sends the task and its version to unmarkInvoiced and shows a refusal in the dialog", async () => {
    unmarkInvoiced.mockResolvedValue({
      ok: false,
      message: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
      reload: true,
    });
    render(<TaskInvoiceActions number={1043} version={V} status="invoiced" />);
    fireEvent.click(screen.getByRole("button", { name: "Markering ongedaan maken" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Ongedaan maken" }));
    });
    const data = unmarkInvoiced.mock.calls[0][1] as FormData;
    expect(data.getAll("task")).toEqual([`1043@${V}`]);
    expect(screen.getByRole("dialog")).toHaveTextContent("Deze taak is intussen gewijzigd.");
    expect(screen.getByRole("button", { name: "Pagina herladen" })).toBeInTheDocument();
  });

  it("closes the dialog with Annuleren without calling the action", async () => {
    render(<TaskInvoiceActions number={1043} version={V} status="invoiced" />);
    fireEvent.click(screen.getByRole("button", { name: "Markering ongedaan maken" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(unmarkInvoiced).not.toHaveBeenCalled();
  });
});
