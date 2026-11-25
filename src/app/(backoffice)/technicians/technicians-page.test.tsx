import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, listTechnicians, inviteTechnician, resendInvite } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  listTechnicians: vi.fn(),
  inviteTechnician: vi.fn(),
  resendInvite: vi.fn(),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/technicians/queries", () => ({ listTechnicians }));
vi.mock("./actions", () => ({ inviteTechnician, resendInvite }));

import TechniciansPage from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

const technicians = [
  {
    id: "t1",
    fullName: "Kevin Wouters",
    email: "kevin@frisair.be",
    status: "active",
    openTasks: 6,
  },
  { id: "t2", fullName: "Yana Willems", email: "yana@frisair.be", status: "invited", openTasks: 0 },
  {
    id: "t3",
    fullName: "Tom Hendrickx",
    email: "tom@frisair.be",
    status: "disabled",
    openTasks: 0,
  },
];

async function renderPage() {
  render(await TechniciansPage());
}

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  listTechnicians.mockResolvedValue(technicians);
});

describe("B7 Techniekers: the list", () => {
  it("checks the backoffice role itself and shows nothing for another role", async () => {
    checkRoleAccess.mockResolvedValue({ kind: "wrong-role", user: sofie });
    expect(await TechniciansPage()).toBeNull();
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
    expect(listTechnicians).not.toHaveBeenCalled();
  });

  it("shows name, e-mail address, status and open tasks per technician", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Techniekers" })).toBeInTheDocument();
    for (const name of ["Naam", "E-mailadres", "Status", "Open taken"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }

    const kevin = screen.getByRole("row", { name: /Kevin Wouters/ });
    expect(within(kevin).getByText("kevin@frisair.be")).toBeInTheDocument();
    expect(within(kevin).getByText("Actief")).toBeInTheDocument();
    expect(within(kevin).getByText("6")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Yana/ })).getByText("Uitgenodigd"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("row", { name: /Tom/ })).getByText("Uitgeschakeld"),
    ).toBeVisible();
  });

  it("offers 'Uitnodiging opnieuw versturen' only for a technician who has not accepted yet", async () => {
    await renderPage();
    const buttons = screen.getAllByRole("button", { name: "Uitnodiging opnieuw versturen" });
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole("row", { name: /Yana/ })).toContainElement(buttons[0]);
    // Switching off and on again are built in BT-07 and BT-07b.
    expect(screen.queryByRole("button", { name: "Uitschakelen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Opnieuw activeren" })).not.toBeInTheDocument();
  });

  it("shows the empty state, with a way to add the first technician", async () => {
    listTechnicians.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Er zijn nog geen techniekers.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Voeg je eerste technieker toe. Hij krijgt een mail om een wachtwoord te kiezen.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Technieker toevoegen" }).length).toBeGreaterThan(
      0,
    );
  });
});

describe("B7 Techniekers: Technieker toevoegen", () => {
  async function openDialog() {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Technieker toevoegen" }));
    return screen.findByRole("dialog", { name: "Technieker toevoegen" });
  }

  it("opens a dialog with the explanation, two labelled fields and the two buttons", async () => {
    const dialog = await openDialog();
    expect(
      within(dialog).getByText(
        "De technieker krijgt een mail met een link om een wachtwoord te kiezen.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Naam/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^E-mailadres/)).toHaveAttribute("type", "email");
    expect(
      within(dialog).getByRole("button", { name: "Uitnodiging versturen" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Annuleren" })).toBeInTheDocument();
  });

  it("closes the dialog and confirms at the top after a successful invitation", async () => {
    inviteTechnician.mockResolvedValue({
      ok: true,
      message:
        "Uitnodiging verstuurd naar nieuw@frisair.be. De technieker krijgt een mail met een link om een wachtwoord te kiezen.",
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/^Naam/), { target: { value: "Nieuwe Tech" } });
    fireEvent.change(within(dialog).getByLabelText(/^E-mailadres/), {
      target: { value: "nieuw@frisair.be" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitnodiging versturen" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Uitnodiging verstuurd naar nieuw@frisair.be.",
    );
    const data = inviteTechnician.mock.calls[0][1] as FormData;
    expect(data.get("fullName")).toBe("Nieuwe Tech");
    expect(data.get("email")).toBe("nieuw@frisair.be");
  });

  it("keeps the dialog open and shows the messages under the fields when the server refuses", async () => {
    inviteTechnician.mockResolvedValue({
      ok: false,
      fieldErrors: { email: "Er bestaat al een gebruiker met dit e-mailadres." },
      values: { fullName: "Kevin", email: "kevin@frisair.be" },
    });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitnodiging versturen" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^E-mailadres/)).toHaveAttribute("aria-invalid", "true"),
    );
    expect(within(dialog).getByLabelText(/^E-mailadres/)).toHaveAccessibleDescription(
      "Er bestaat al een gebruiker met dit e-mailadres.",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Vul het gemarkeerde veld in.");
    expect(within(dialog).getByLabelText(/^E-mailadres/)).toHaveValue("kevin@frisair.be");
    expect(within(dialog).getByLabelText(/^Naam/)).toHaveValue("Kevin");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a form error such as 'too many mails' in the dialog", async () => {
    inviteTechnician.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Er zijn te veel mails verstuurd. Probeer het over enkele minuten opnieuw.",
    });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitnodiging versturen" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Er zijn te veel mails verstuurd.",
      ),
    );
  });

  it("starts with an empty form every time the dialog is opened", async () => {
    inviteTechnician.mockResolvedValue({
      ok: false,
      fieldErrors: { fullName: "Vul de naam in." },
      values: { fullName: "", email: "x@y.be" },
    });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitnodiging versturen" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());

    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Technieker toevoegen" }));
    const again = await screen.findByRole("dialog", { name: "Technieker toevoegen" });
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(again).getByLabelText(/^E-mailadres/)).toHaveValue("");
  });
});

describe("B7 Techniekers: Uitnodiging opnieuw versturen", () => {
  it("sends the id of the technician and confirms at the top", async () => {
    resendInvite.mockResolvedValue({
      ok: true,
      message: "Uitnodiging opnieuw verstuurd naar yana@frisair.be.",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Uitnodiging opnieuw versturen" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Uitnodiging opnieuw verstuurd naar yana@frisair.be.",
      ),
    );
    expect((resendInvite.mock.calls[0][1] as FormData).get("id")).toBe("t2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the reason at the top, as an alert, when the server refuses", async () => {
    resendInvite.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Yana Willems heeft al een wachtwoord gekozen. Laad de pagina opnieuw.",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Uitnodiging opnieuw versturen" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Yana Willems heeft al een wachtwoord gekozen.",
      ),
    );
  });
});
