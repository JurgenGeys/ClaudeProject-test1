import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resetTask, refresh } = vi.hoisted(() => ({ resetTask: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ resetTask }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ResetTaskDialog, type ResetTaskDialogProps } from "./reset-task-dialog";

const KEVIN = "22222222-2222-4222-8222-222222222222";
const JENS = "33333333-3333-4333-8333-333333333333";
const VERSION = "2026-11-25T18:44:00.123456Z";

const props: ResetTaskDialogProps = {
  taskNumber: 1043,
  version: VERSION,
  technicians: [
    { id: KEVIN, fullName: "Kevin Wouters" },
    { id: JENS, fullName: "Jens Maes" },
  ],
  currentAssigneeId: KEVIN,
  scheduledDate: "2026-11-24",
  startTime: "08:00",
};

async function openDialog(overrides: Partial<ResetTaskDialogProps> = {}) {
  render(<ResetTaskDialog {...props} {...overrides} />);
  fireEvent.click(screen.getByRole("button", { name: "Terugzetten" }));
  return screen.findByRole("dialog");
}

async function submit(dialog: HTMLElement) {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Terugzetten" }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("the dialog Terugzetten", () => {
  it("has the texts of the design and starts with the current technician, date and start time", async () => {
    const dialog = await openDialog();
    expect(screen.getByRole("dialog", { name: "Taak terugzetten" })).toBe(dialog);
    expect(dialog).toHaveTextContent(
      "Gebruik dit als de taak niet kon doorgaan, bv. omdat de klant niet thuis was. De taak komt terug op Toegewezen. Je kan meteen een andere technieker of datum kiezen.",
    );
    expect(within(dialog).getByLabelText("Technieker")).toHaveValue(KEVIN);
    expect(within(dialog).getByLabelText("Datum")).toHaveValue("2026-11-24");
    expect(within(dialog).getByLabelText("Startuur")).toHaveValue("08:00");
    expect(within(dialog).getByLabelText("Startuur")).toHaveAttribute("step", "900");
  });

  it("offers only the technicians it was given", async () => {
    const dialog = await openDialog();
    const options = within(within(dialog).getByLabelText("Technieker")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Kevin Wouters", "Jens Maes"]);
  });

  it("asks to choose when the current technician cannot be chosen any more", async () => {
    const dialog = await openDialog({ currentAssigneeId: "44444444-4444-4444-8444-444444444444" });
    const select = within(dialog).getByLabelText("Technieker");
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Kies een technieker");
  });

  it("has tap targets of 44 px on a phone", async () => {
    const dialog = await openDialog();
    for (const element of [
      within(dialog).getByLabelText("Technieker"),
      within(dialog).getByLabelText("Datum"),
      within(dialog).getByLabelText("Startuur"),
      within(dialog).getByRole("button", { name: "Annuleren" }),
      within(dialog).getByRole("button", { name: "Terugzetten" }),
    ]) {
      expect(element).toHaveClass("h-11");
    }
  });

  it("closes with Annuleren without asking the server", async () => {
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(resetTask).not.toHaveBeenCalled();
  });

  it("closes with Escape and gives the focus back to the button", async () => {
    await openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Terugzetten" })).toHaveFocus());
  });

  it("moves the focus into the dialog", async () => {
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("sends the task number, the version and what was chosen, and nothing else", async () => {
    resetTask.mockResolvedValue(null);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Technieker"), { target: { value: JENS } });
    fireEvent.change(within(dialog).getByLabelText("Datum"), { target: { value: "2026-12-01" } });
    fireEvent.change(within(dialog).getByLabelText("Startuur"), { target: { value: "13:15" } });
    await submit(dialog);

    expect(resetTask).toHaveBeenCalledTimes(1);
    const data = resetTask.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({
      taskNumber: "1043",
      version: VERSION,
      assigneeId: JENS,
      scheduledDate: "2026-12-01",
      startTime: "13:15",
    });
  });

  it("shows a refusal under the field it belongs to and keeps the dialog open", async () => {
    resetTask.mockResolvedValue({
      ok: false,
      fieldErrors: { assigneeId: "Kevin Wouters is niet meer actief. Kies een andere technieker." },
    });
    const dialog = await openDialog();
    await submit(dialog);
    const select = await within(dialog).findByLabelText("Technieker");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription(
      "Kevin Wouters is niet meer actief. Kies een andere technieker.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps what was chosen after a refusal, so a second click cannot save the old planning", async () => {
    resetTask.mockResolvedValue({
      ok: false,
      fieldErrors: { scheduledDate: "Kies een datum." },
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Technieker"), { target: { value: JENS } });
    fireEvent.change(within(dialog).getByLabelText("Datum"), { target: { value: "2026-12-01" } });
    fireEvent.change(within(dialog).getByLabelText("Startuur"), { target: { value: "13:15" } });
    await submit(dialog);
    await within(dialog).findByText("Kies een datum.");

    expect(within(dialog).getByLabelText("Technieker")).toHaveValue(JENS);
    expect(within(dialog).getByLabelText("Datum")).toHaveValue("2026-12-01");
    expect(within(dialog).getByLabelText("Startuur")).toHaveValue("13:15");

    await submit(dialog);
    const data = resetTask.mock.calls[1][1] as FormData;
    expect(data.get("assigneeId")).toBe(JENS);
    expect(data.get("scheduledDate")).toBe("2026-12-01");
  });

  it("starts afresh every time it is opened: no old message, the current planning again", async () => {
    resetTask.mockResolvedValue({ ok: false, fieldErrors: {}, formError: "Dat is niet gelukt." });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Technieker"), { target: { value: JENS } });
    await submit(dialog);
    await within(dialog).findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Terugzetten" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).queryByRole("alert")).toBeNull();
    expect(within(again).getByLabelText("Technieker")).toHaveValue(KEVIN);
  });

  it("says the task changed meanwhile and reloads the page on request", async () => {
    resetTask.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
      reload: true,
    });
    const dialog = await openDialog();
    await submit(dialog);
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.");
    await waitFor(() => expect(alert).toHaveFocus());

    fireEvent.click(within(alert).getByRole("button", { name: "Pagina herladen" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a technical problem without a reload button", async () => {
    resetTask.mockResolvedValue({ ok: false, fieldErrors: {}, formError: "Dat is niet gelukt." });
    const dialog = await openDialog();
    await submit(dialog);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
    expect(within(dialog).queryByRole("button", { name: "Pagina herladen" })).toBeNull();
  });
});
