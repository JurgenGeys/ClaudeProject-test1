import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeTask, refresh, replace } = vi.hoisted(() => ({
  completeTask: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("../../actions", () => ({ completeTask }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
  // Like Next: rethrows its own control-flow errors (a redirect), ignores any other error.
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
  },
}));

import { CompleteTaskForm } from "./complete-task-form";

const VERSION = "2026-11-25T18:44:00.123456Z";

function show(officePhone?: string) {
  return render(
    <CompleteTaskForm
      taskNumber={1042}
      version={VERSION}
      customerName="Bakkerij De Gouden Korst"
      scheduledDate="2026-11-26"
      startTime="08:00:00"
      now={new Date("2026-11-26T07:00:00Z")}
      officePhone={officePhone}
    />,
  );
}

const hoursValue = () => screen.getByTestId("hours-value");
const more = () => screen.getByRole("button", { name: "Kwartier meer" });
const less = () => screen.getByRole("button", { name: "Kwartier minder" });
const submit = () => screen.getByRole("button", { name: /Taak afmelden|Bezig met afmelden/ });

async function send() {
  await act(async () => {
    fireEvent.submit(submit().closest("form")!);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("T3: content", () => {
  it("shows number, customer and day, the help text and the example text", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Taak afmelden" })).toBeInTheDocument();
    expect(
      screen.getByText("Bakkerij De Gouden Korst", { exact: false }).closest("p"),
    ).toHaveTextContent("Taak #1042 · Bakkerij De Gouden Korst · vandaag 08:00");
    expect(
      screen.getByText("Enkel de tijd bij de klant. De verplaatsing telt niet mee."),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Bv. filter vervangen, toestel lekt licht aan binnenunit"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Notities/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Annuleren" })).toHaveAttribute(
      "href",
      "/my-tasks/1042",
    );
    expect(screen.getByRole("link", { name: "← Terug naar de taak" })).toHaveAttribute(
      "href",
      "/my-tasks/1042",
    );
  });

  it("has tap targets of at least 44 px", () => {
    show();
    expect(more()).toHaveClass("h-14", "w-14");
    expect(less()).toHaveClass("h-14", "w-14");
    for (const name of ["0u30", "1u00", "1u30", "2u00"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("h-11");
    }
    expect(submit()).toHaveClass("h-12");
    expect(screen.getByRole("link", { name: "Annuleren" })).toHaveClass("h-12");
  });
});

describe("T3: the stepper", () => {
  it("starts on 0u00 with minus off, steps per quarter, and stops at 16u00", () => {
    show();
    expect(hoursValue()).toHaveTextContent("0u00");
    expect(less()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(less());
    expect(hoursValue()).toHaveTextContent("0u00");

    fireEvent.click(more());
    expect(hoursValue()).toHaveTextContent("0u15");
    expect(less()).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(more());
    fireEvent.click(more());
    expect(hoursValue()).toHaveTextContent("0u45");
    fireEvent.click(less());
    expect(hoursValue()).toHaveTextContent("0u30");

    fireEvent.click(screen.getByRole("button", { name: "2u00" }));
    for (let index = 0; index < 100; index += 1) {
      fireEvent.click(more());
    }
    expect(hoursValue()).toHaveTextContent("16u00");
    expect(more()).toHaveAttribute("aria-disabled", "true");
  });

  it("reads the value for screen readers in words (formatHoursSpoken) in a live region", () => {
    show();
    const output = hoursValue().closest("output")!;
    expect(output).toHaveAttribute("aria-live", "polite");
    expect(output).toHaveTextContent("nog geen uren");
    fireEvent.click(screen.getByRole("button", { name: "1u30" }));
    expect(output).toHaveTextContent("1 uur 30 minuten");
    expect(hoursValue()).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(less());
    fireEvent.click(less());
    fireEvent.click(less());
    expect(output).toHaveTextContent("45 minuten");
  });

  it("marks the quick choice that is selected", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "1u00" }));
    expect(screen.getByRole("button", { name: "1u00" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "0u30" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("T3: sending", () => {
  it("sends the number, the version, the minutes and the notes", async () => {
    completeTask.mockResolvedValue(null);
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "1u30" }));
    fireEvent.change(screen.getByLabelText(/Notities/), { target: { value: "Filter vervangen" } });
    await send();
    const data = completeTask.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({
      taskNumber: "1042",
      version: VERSION,
      workedMinutes: "90",
      notes: "Filter vervangen",
    });
  });

  it("shows the summary with the focus and the message under the hours, and keeps the notes", async () => {
    completeTask.mockResolvedValue({
      ok: false,
      kind: "fields",
      message: "Vul de gewerkte uren in om af te melden.",
      fieldErrors: { workedMinutes: "Vul de gewerkte uren in. Dat moet minstens 0u15 zijn." },
    });
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/Notities/), { target: { value: "Mijn tekst" } });
    await send();
    const summary = await screen.findByText("Vul de gewerkte uren in om af te melden.");
    await waitFor(() => expect(summary.closest("div")).toHaveFocus());
    expect(
      screen.getByText("Vul de gewerkte uren in. Dat moet minstens 0u15 zijn."),
    ).toHaveAttribute("id", "hours-error");
    expect(screen.getByLabelText(/Notities/)).toHaveValue("Mijn tekst");
  });

  it("shows the message of a too long note under the notes field", async () => {
    completeTask.mockResolvedValue({
      ok: false,
      kind: "fields",
      message: "Vul het gemarkeerde veld in.",
      fieldErrors: { notes: "Je notitie is te lang. Houd het korter dan 2000 tekens." },
    });
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    await send();
    const error = await screen.findByText(/Je notitie is te lang/);
    expect(screen.getByLabelText(/Notities/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Notities/).getAttribute("aria-describedby")).toContain(error.id);
  });

  it("'changed': message and a button that reads the page again, keeping the hours", async () => {
    completeTask.mockResolvedValue({
      ok: false,
      kind: "changed",
      message: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
    });
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "1u00" }));
    await send();
    await screen.findByText("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.");
    const reload = screen.getByRole("button", { name: "Pagina herladen" });
    expect(reload).toHaveClass("h-11");
    fireEvent.click(reload);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/intussen gewijzigd/)).not.toBeInTheDocument();
    expect(hoursValue()).toHaveTextContent("1u00");
  });

  it("'not-assigned': the message with the office number, a way back, and no form", async () => {
    completeTask.mockResolvedValue({
      ok: false,
      kind: "not-assigned",
      message: "Deze taak is niet meer aan jou toegewezen.",
    });
    show("014 00 00 00");
    await waitFor(() => expect(submit()).toBeEnabled());
    await send();
    await screen.findByText("Deze taak is niet meer aan jou toegewezen.");
    expect(screen.getByRole("link", { name: "014 00 00 00" })).toHaveAttribute(
      "href",
      expect.stringContaining("tel:"),
    );
    expect(screen.getByRole("link", { name: "Terug naar mijn taken" })).toHaveAttribute(
      "href",
      "/my-tasks",
    );
    expect(screen.queryByRole("button", { name: "Taak afmelden" })).not.toBeInTheDocument();
  });

  it("'cancelled': goes to T2, which says that the task was cancelled", async () => {
    completeTask.mockResolvedValue({
      ok: false,
      kind: "cancelled",
      message: "Deze taak is geannuleerd door kantoor. Je hoeft niets meer te doen.",
    });
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    await send();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/my-tasks/1042"));
  });

  it("a redirect after a finished task is no error message", async () => {
    completeTask.mockRejectedValue(new Error("NEXT_REDIRECT"));
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "1u00" }));
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      await send().catch(() => {});
    } catch {
      // The redirect error goes on to Next, which navigates.
    }
    expect(screen.queryByText(/Dat is niet gelukt/)).not.toBeInTheDocument();
    expect(document.getElementById("complete-problem")).toBeNull();
    window.removeEventListener("unhandledrejection", onRejection);
  });

  it("a connection problem keeps what was typed and says so", async () => {
    completeTask.mockRejectedValue(new TypeError("fetch failed"));
    show();
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "0u30" }));
    await send();
    await screen.findByText(
      "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    );
    expect(hoursValue()).toHaveTextContent("0u30");
    expect(submit()).toBeEnabled();
  });
});
