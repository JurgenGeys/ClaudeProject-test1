import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pickUpTask, refresh } = vi.hoisted(() => ({ pickUpTask: vi.fn(), refresh: vi.fn() }));
vi.mock("../actions", () => ({ pickUpTask }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import {
  CANCELLED_HEADING_ID,
  PICKED_UP_NOTICE_ID,
  PickUpAlert,
  PickUpBar,
  PickUpTask,
} from "./pick-up-task";

const VERSION = "2026-11-25T18:44:00.123456Z";

function screenWith(officePhone?: string) {
  return render(
    <PickUpTask>
      <PickUpAlert officePhone={officePhone} />
      <h1>Taak</h1>
      <PickUpBar taskNumber={1042} version={VERSION} customerName="Bakkerij De Gouden Korst" />
    </PickUpTask>,
  );
}

/** The message at the top of the page: focused, not a `role="alert"`. */
async function findProblem() {
  return waitFor(() => {
    const element = document.getElementById("pick-up-problem");
    if (!element) {
      throw new Error("no message yet");
    }
    return element;
  });
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Oppikken" }));
  return screen.findByRole("dialog");
}

async function confirm() {
  const dialog = await openDialog();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Ja, ik vertrek" }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("the confirmation of Oppikken", () => {
  it("asks the question of the design, with the customer, and has two buttons of 48 px", async () => {
    screenWith();
    const dialog = await openDialog();
    expect(screen.getByRole("dialog", { name: "Taak oppikken?" })).toBe(dialog);
    expect(dialog).toHaveTextContent(
      "Kantoor ziet dan dat je onderweg bent naar Bakkerij De Gouden Korst. Je kan dit niet zelf ongedaan maken.",
    );
    const yes = within(dialog).getByRole("button", { name: "Ja, ik vertrek" });
    const no = within(dialog).getByRole("button", { name: "Annuleren" });
    expect(yes).toHaveClass("h-12");
    expect(no).toHaveClass("h-12");
    // No small corner cross: the two buttons are the way to close it.
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
  });

  it("puts the focus on Annuleren, the safe choice, and Annuleren closes without asking the server", async () => {
    screenWith();
    const dialog = await openDialog();
    const no = within(dialog).getByRole("button", { name: "Annuleren" });
    await waitFor(() => expect(no).toHaveFocus());
    fireEvent.click(no);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(pickUpTask).not.toHaveBeenCalled();
  });

  it("closes with Escape and gives the focus back to Oppikken", async () => {
    screenWith();
    await openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Oppikken" })).toHaveFocus());
  });

  it("sends only the task number and the version", async () => {
    pickUpTask.mockResolvedValue({ ok: true });
    screenWith();
    await confirm();
    expect(pickUpTask).toHaveBeenCalledTimes(1);
    const formData = pickUpTask.mock.calls[0][1] as FormData;
    expect([...formData.keys()].sort()).toEqual(["taskNumber", "version"]);
    expect(formData.get("taskNumber")).toBe("1042");
    expect(formData.get("version")).toBe(VERSION);
  });

  it("closes after success and moves the focus to the 'Opgepikt om' notice once the page has it", async () => {
    pickUpTask.mockResolvedValue({ ok: true });
    screenWith();
    await confirm();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The server renders the notice a moment later.
    const notice = document.createElement("div");
    notice.id = PICKED_UP_NOTICE_ID;
    notice.tabIndex = -1;
    document.body.append(notice);
    await waitFor(() => expect(notice).toHaveFocus());
    notice.remove();
  });

  it("disables both buttons while the answer is on its way", async () => {
    let answer!: (value: unknown) => void;
    pickUpTask.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    screenWith();
    await confirm();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Bezig met oppikken…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Annuleren" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => answer({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open with the message after a technical problem, and clears it on the next try", async () => {
    pickUpTask.mockResolvedValue({
      ok: false,
      kind: "error",
      message: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    screenWith();
    await confirm();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Dat is niet gelukt. Controleer je internetverbinding");
    expect(within(dialog).getByRole("button", { name: "Ja, ik vertrek" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await openDialog()).not.toHaveTextContent("Dat is niet gelukt");
  });
});

describe("when the task was moved meanwhile", () => {
  const notAssigned = {
    ok: false,
    kind: "not-assigned",
    message: "Deze taak is niet meer aan jou toegewezen.",
  };

  it("shows the message of the design with the office number, a way back, and no button any more", async () => {
    pickUpTask.mockResolvedValue(notAssigned);
    screenWith("014 00 00 00");
    await confirm();
    const alert = await findProblem();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(alert).toHaveTextContent("Deze taak is niet meer aan jou toegewezen.");
    expect(alert).toHaveTextContent("Bel kantoor als dit niet klopt: 014 00 00 00.");
    expect(within(alert).getByRole("link", { name: "014 00 00 00" })).toHaveAttribute(
      "href",
      "tel:014000000",
    );
    expect(within(alert).getByRole("link", { name: "014 00 00 00" })).toHaveClass("min-h-11");
    const back = within(alert).getByRole("link", { name: "Terug naar mijn taken" });
    expect(back).toHaveAttribute("href", "/my-tasks");
    expect(back).toHaveClass("h-11");
    expect(alert).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Oppikken" })).not.toBeInTheDocument();
  });

  it("says only 'Bel kantoor als dit niet klopt.' when the office number is not set", async () => {
    pickUpTask.mockResolvedValue(notAssigned);
    screenWith(undefined);
    await confirm();
    const alert = await findProblem();
    expect(alert).toHaveTextContent("Deze taak is niet meer aan jou toegewezen.");
    expect(alert).toHaveTextContent("Bel kantoor als dit niet klopt.");
    expect(within(alert).queryByRole("link", { name: /^\d/ })).not.toBeInTheDocument();
  });

  it("offers a reload when the task changed, and that clears the message and refreshes the page", async () => {
    pickUpTask.mockResolvedValue({
      ok: false,
      kind: "changed",
      message: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
    });
    screenWith();
    await confirm();
    const alert = await findProblem();
    expect(alert).toHaveTextContent("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.");
    const reload = within(alert).getByRole("button", { name: "Pagina herladen" });
    expect(reload).toHaveClass("h-11");
    fireEvent.click(reload);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/niet meer aan jou|intussen gewijzigd/)).not.toBeInTheDocument();
    // With a fresh page the button is back.
    expect(screen.getByRole("button", { name: "Oppikken" })).toBeInTheDocument();
  });
});

describe("when the task was cancelled meanwhile", () => {
  it("closes the dialog and moves the focus to the heading that the page shows for a cancelled task", async () => {
    pickUpTask.mockResolvedValue({
      ok: false,
      kind: "cancelled",
      message: "Deze taak is geannuleerd door kantoor. Je hoeft niets meer te doen.",
    });
    screenWith();
    await confirm();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const heading = document.createElement("h1");
    heading.id = CANCELLED_HEADING_ID;
    heading.tabIndex = -1;
    document.body.append(heading);
    await waitFor(() => expect(heading).toHaveFocus());
    heading.remove();
  });
});
