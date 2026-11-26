import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelTask, refresh } = vi.hoisted(() => ({ cancelTask: vi.fn(), refresh: vi.fn() }));
vi.mock("./cancel-actions", () => ({ cancelTask }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CancelTaskDialog, type CancelTaskDialogProps } from "./cancel-task-dialog";

const VERSION = "2026-11-25T18:44:00.123456Z";

const props: CancelTaskDialogProps = {
  taskNumber: 1043,
  taskLabel: "#1043",
  version: VERSION,
  assigneeName: "Kevin Wouters",
};

async function openDialog(overrides: Partial<CancelTaskDialogProps> = {}) {
  render(<CancelTaskDialog {...props} {...overrides} />);
  fireEvent.click(screen.getByRole("button", { name: "Taak annuleren" }));
  return screen.findByRole("dialog");
}

async function confirm(dialog: HTMLElement) {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Taak annuleren" }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("the dialog Taak annuleren", () => {
  it("has the title and the texts of the design, with the technician of a Toegewezen task", async () => {
    const dialog = await openDialog();
    expect(screen.getByRole("dialog", { name: "Taak #1043 annuleren?" })).toBe(dialog);
    expect(dialog).toHaveTextContent(
      'Gebruik dit als de afspraak niet meer doorgaat, bv. omdat de klant afzegt. De taak verdwijnt uit de planning en uit de lijst van Kevin Wouters. Ze blijft bewaard onder "Geannuleerd".',
    );
    expect(dialog).toHaveTextContent(
      "Annuleren kan je niet ongedaan maken. Moet het werk toch gebeuren, maak dan een nieuwe taak aan.",
    );
    expect(dialog).toHaveAccessibleDescription(/Annuleren kan je niet ongedaan maken/);
  });

  it("leaves the technician out of the text for an Open task", async () => {
    const dialog = await openDialog({ assigneeName: null });
    expect(dialog).toHaveTextContent(
      'De taak verdwijnt uit de planning. Ze blijft bewaard onder "Geannuleerd".',
    );
    expect(dialog).not.toHaveTextContent("uit de lijst van");
  });

  it("has an optional reason field with the example of the design and a limit of 500 characters", async () => {
    const dialog = await openDialog();
    const reason = within(dialog).getByLabelText(/Reden/);
    expect(within(dialog).getByText("Reden", { exact: false })).toHaveTextContent(
      "Reden(niet verplicht)",
    );
    expect(reason).toHaveAttribute("placeholder", "Bv. klant heeft zelf afgezegd");
    expect(reason).toHaveAttribute("maxlength", "500");
    expect(reason).not.toBeRequired();
  });

  it("closes with 'Taak behouden' (not 'Annuleren') without asking the server", async () => {
    const dialog = await openDialog();
    expect(within(dialog).queryByRole("button", { name: "Annuleren" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Taak behouden" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it("closes with Escape and gives the focus back to the button", async () => {
    await openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Taak annuleren" })).toHaveFocus(),
    );
  });

  it("moves the focus into the dialog", async () => {
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("has tap targets of 44 px on a phone", async () => {
    render(<CancelTaskDialog {...props} />);
    const trigger = screen.getByRole("button", { name: "Taak annuleren" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    for (const button of [
      trigger,
      within(dialog).getByRole("button", { name: "Taak behouden" }),
      within(dialog).getByRole("button", { name: "Taak annuleren" }),
    ]) {
      expect(button).toHaveClass("h-11");
    }
  });

  it("sends the task number, the version and the reason, and nothing else", async () => {
    cancelTask.mockResolvedValue(null);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Reden/), {
      target: { value: "Klant heeft zelf afgezegd" },
    });
    await confirm(dialog);

    expect(cancelTask).toHaveBeenCalledTimes(1);
    const data = cancelTask.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({
      taskNumber: "1043",
      version: VERSION,
      reason: "Klant heeft zelf afgezegd",
    });
  });

  it("can cancel without a reason", async () => {
    cancelTask.mockResolvedValue(null);
    const dialog = await openDialog();
    await confirm(dialog);
    expect((cancelTask.mock.calls[0][1] as FormData).get("reason")).toBe("");
  });

  it("shows the message of a reason that is too long under the field", async () => {
    cancelTask.mockResolvedValue({
      ok: false,
      fieldErrors: { reason: "De reden is te lang. Houd ze korter dan 500 tekens." },
    });
    const dialog = await openDialog();
    await confirm(dialog);
    const reason = await within(dialog).findByLabelText(/Reden/);
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription(
      "De reden is te lang. Houd ze korter dan 500 tekens.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the reason after a refusal, so a second click does not lose it", async () => {
    cancelTask.mockResolvedValue({ ok: false, fieldErrors: {}, formError: "Dat is niet gelukt." });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Reden/), {
      target: { value: "Klant belt terug" },
    });
    await confirm(dialog);
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByLabelText(/Reden/)).toHaveValue("Klant belt terug");

    await confirm(dialog);
    expect((cancelTask.mock.calls[1][1] as FormData).get("reason")).toBe("Klant belt terug");
  });

  it("starts afresh every time it is opened: no old message, an empty reason", async () => {
    cancelTask.mockResolvedValue({ ok: false, fieldErrors: {}, formError: "Dat is niet gelukt." });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Reden/), {
      target: { value: "Klant belt terug" },
    });
    await confirm(dialog);
    await within(dialog).findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "Taak behouden" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Taak annuleren" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).queryByRole("alert")).toBeNull();
    expect(within(again).getByLabelText(/Reden/)).toHaveValue("");
  });

  it("says that the technician picked the task up, with the focus on the message and a reload", async () => {
    cancelTask.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError:
        "Kevin Wouters heeft deze taak intussen opgepikt. Bel hem eerst; zet de taak daarna terug als ze echt niet doorgaat.",
      reload: true,
    });
    const dialog = await openDialog();
    await confirm(dialog);
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Kevin Wouters heeft deze taak intussen opgepikt.");
    await waitFor(() => expect(alert).toHaveFocus());

    fireEvent.click(within(alert).getByRole("button", { name: "Pagina herladen" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a technical problem without a reload button", async () => {
    cancelTask.mockResolvedValue({ ok: false, fieldErrors: {}, formError: "Dat is niet gelukt." });
    const dialog = await openDialog();
    await confirm(dialog);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
    expect(within(dialog).queryByRole("button", { name: "Pagina herladen" })).toBeNull();
  });

  it("does not close while the answer is on its way, and disables both buttons", async () => {
    let finish!: (value: null) => void;
    cancelTask.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const dialog = await openDialog();
    await confirm(dialog);

    expect(within(dialog).getByRole("button", { name: "Bezig met annuleren…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Taak behouden" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => finish(null));
  });
});
