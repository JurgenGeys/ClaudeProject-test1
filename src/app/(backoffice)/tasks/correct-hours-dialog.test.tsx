import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { correctHours, refresh } = vi.hoisted(() => ({ correctHours: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ correctHours }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CorrectHoursDialog, type CorrectHoursDialogProps } from "./correct-hours-dialog";

const VERSION = "2026-11-25T18:44:00.123456Z";

const props: CorrectHoursDialogProps = {
  taskNumber: 1043,
  version: VERSION,
  completedByName: "Kevin Wouters",
  workedMinutes: 120,
  currentMinutes: 120,
};

async function openDialog(overrides: Partial<CorrectHoursDialogProps> = {}) {
  render(<CorrectHoursDialog {...props} {...overrides} />);
  fireEvent.click(screen.getByRole("button", { name: "Uren corrigeren" }));
  return screen.findByRole("dialog");
}

async function submit(dialog: HTMLElement) {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Correctie bewaren" }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("the dialog Uren corrigeren", () => {
  it("shows the original hours and the technician, as the design says", async () => {
    const dialog = await openDialog();
    expect(screen.getByRole("dialog", { name: "Uren corrigeren" })).toBe(dialog);
    expect(dialog).toHaveTextContent(
      "Ingevuld door Kevin Wouters: 2u00. De oorspronkelijke uren blijven zichtbaar.",
    );
  });

  it("offers every quarter from 0u15 to 16u00 and starts with the hours that count now", async () => {
    const dialog = await openDialog({ currentMinutes: 90 });
    const select = within(dialog).getByLabelText(/Nieuwe uren/);
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(64);
    expect(options[0]).toHaveTextContent("0u15");
    expect(options[63]).toHaveTextContent("16u00");
    expect(select).toHaveValue("90");
    expect(dialog).toHaveTextContent("Per kwartier, zonder verplaatsing.");
  });

  it("sends the number, the version, the new hours and the reason, and nothing else", async () => {
    correctHours.mockResolvedValue(null);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Nieuwe uren/), { target: { value: "90" } });
    fireEvent.change(within(dialog).getByLabelText(/Reden/), {
      target: { value: "Pauze niet afgetrokken" },
    });
    await submit(dialog);
    expect(correctHours).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries((correctHours.mock.calls[0][1] as FormData).entries())).toEqual({
      taskNumber: "1043",
      version: VERSION,
      correctedMinutes: "90",
      reason: "Pauze niet afgetrokken",
    });
  });

  it("shows a missing reason under the field, keeps the dialog open and keeps the chosen hours", async () => {
    correctHours.mockResolvedValue({
      ok: false,
      fieldErrors: { reason: "Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'." },
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Nieuwe uren/), { target: { value: "60" } });
    await submit(dialog);
    const reason = await within(dialog).findByLabelText(/Reden/);
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription(
      "Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'.",
    );
    await waitFor(() => expect(reason).toHaveFocus());
    expect(within(dialog).getByLabelText(/Nieuwe uren/)).toHaveValue("60");

    // A second click sends what was chosen, not the old hours.
    await submit(dialog);
    expect((correctHours.mock.calls[1][1] as FormData).get("correctedMinutes")).toBe("60");
  });

  it("keeps the typed reason and hours after a refusal for the whole dialog", async () => {
    correctHours.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt.",
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Nieuwe uren/), { target: { value: "75" } });
    fireEvent.change(within(dialog).getByLabelText(/Reden/), { target: { value: "Sleutel" } });
    await submit(dialog);
    await within(dialog).findByText("Dat is niet gelukt.");
    expect(within(dialog).getByLabelText(/Nieuwe uren/)).toHaveValue("75");
    expect(within(dialog).getByLabelText(/Reden/)).toHaveValue("Sleutel");
    expect(within(dialog).queryByRole("button", { name: "Pagina herladen" })).toBeNull();
  });

  it("says the task is invoiced and reloads the page on request", async () => {
    correctHours.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError:
        "Deze taak is al gefactureerd. Maak eerst de markering ongedaan als je de uren wilt wijzigen.",
      reload: true,
    });
    const dialog = await openDialog();
    await submit(dialog);
    await within(dialog).findByText(/Deze taak is al gefactureerd/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pagina herladen" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("has tap targets of 44 px on a phone", async () => {
    const dialog = await openDialog();
    for (const element of [
      within(dialog).getByLabelText(/Nieuwe uren/),
      within(dialog).getByRole("button", { name: "Annuleren" }),
      within(dialog).getByRole("button", { name: "Correctie bewaren" }),
    ]) {
      expect(element).toHaveClass("h-11");
    }
  });

  it("closes with Annuleren without asking the server, and starts afresh when opened again", async () => {
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Reden/), { target: { value: "Iets" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(correctHours).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Uren corrigeren" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText(/Reden/)).toHaveValue("");
  });

  it("limits the reason to 500 characters in the field", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText(/Reden/)).toHaveAttribute("maxlength", "500");
  });

  it("does not close on Escape while the answer is on its way", async () => {
    let answer!: (value: null) => void;
    correctHours.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const dialog = await openDialog();
    await submit(dialog);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => answer(null));
  });

  it("closes with Escape", async () => {
    await openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
