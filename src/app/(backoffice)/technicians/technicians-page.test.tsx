import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  checkRoleAccess,
  listTechnicians,
  inviteTechnician,
  resendInvite,
  deactivateTechnician,
  reactivateTechnician,
  revokeInvitation,
} = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  listTechnicians: vi.fn(),
  inviteTechnician: vi.fn(),
  resendInvite: vi.fn(),
  deactivateTechnician: vi.fn(),
  reactivateTechnician: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/technicians/queries", () => ({ listTechnicians }));
vi.mock("./actions", () => ({
  inviteTechnician,
  resendInvite,
  deactivateTechnician,
  reactivateTechnician,
  revokeInvitation,
}));

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
  });

  it("offers 'Uitnodiging intrekken' only for an invited technician", async () => {
    await renderPage();
    const buttons = screen.getAllByRole("button", { name: /^Uitnodiging intrekken: / });
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole("row", { name: /Yana/ })).toContainElement(buttons[0]);
  });

  it("confirms 'Uitnodiging intrekken' in a dialog and shows the confirmation above the list", async () => {
    revokeInvitation.mockResolvedValue({
      ok: true,
      message:
        "De uitnodiging van Yana Willems is ingetrokken. De link in de mail werkt niet meer.",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Uitnodiging intrekken: Yana Willems" }));

    const dialog = await screen.findByRole("dialog", {
      name: "De uitnodiging van Yana Willems intrekken?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitnodiging intrekken" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "De uitnodiging van Yana Willems is ingetrokken.",
      ),
    );
    expect((revokeInvitation.mock.calls[0][1] as FormData).get("id")).toBe("t2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the reason when revoking is refused", async () => {
    revokeInvitation.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Yana Willems heeft al een wachtwoord gekozen. Laad de pagina opnieuw.",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Uitnodiging intrekken: Yana Willems" }));
    const dialog = await screen.findByRole("dialog", {
      name: "De uitnodiging van Yana Willems intrekken?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitnodiging intrekken" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Laad de pagina opnieuw.");
  });

  it("offers 'Opnieuw activeren' only for a switched-off technician", async () => {
    await renderPage();
    const buttons = screen.getAllByRole("button", { name: "Opnieuw activeren" });
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole("row", { name: /Tom/ })).toContainElement(buttons[0]);
  });

  it("confirms 'Opnieuw activeren' in a dialog and shows the confirmation above the list", async () => {
    reactivateTechnician.mockResolvedValue({
      ok: true,
      message: "Tom Hendrickx is opnieuw actief. Je kan hem weer taken toewijzen.",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw activeren" }));

    const dialog = await screen.findByRole("dialog", { name: "Tom Hendrickx opnieuw activeren?" });
    expect(dialog).toHaveTextContent(
      'Hij kan zich dan weer aanmelden met zijn vorige wachtwoord. Weet hij dat niet meer, dan gebruikt hij "Wachtwoord vergeten" op het aanmeldscherm.',
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Opnieuw activeren" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Tom Hendrickx is opnieuw actief. Je kan hem weer taken toewijzen.",
      ),
    );
    const formData = reactivateTechnician.mock.calls[0][1] as FormData;
    expect(formData.get("id")).toBe("t3");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the reason when switching on is refused", async () => {
    reactivateTechnician.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Tom Hendrickx is al actief. Laad de pagina opnieuw.",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw activeren" }));
    const dialog = await screen.findByRole("dialog", { name: "Tom Hendrickx opnieuw activeren?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opnieuw activeren" }));

    expect(await within(dialog).findByText(/is al actief/)).toBeVisible();
  });

  it("offers 'Uitschakelen' only for an active technician, not for invited or switched-off ones", async () => {
    await renderPage();
    const buttons = screen.getAllByRole("button", { name: "Uitschakelen" });
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole("row", { name: /Kevin/ })).toContainElement(buttons[0]);
    expect(
      within(screen.getByRole("row", { name: /Tom/ })).queryByRole("button", {
        name: "Uitschakelen",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Yana/ })).queryByRole("button", {
        name: "Uitschakelen",
      }),
    ).not.toBeInTheDocument();
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

describe("B7 Techniekers: Uitschakelen", () => {
  const bram = {
    id: "t4",
    fullName: "Bram Claes",
    email: "bram@frisair.be",
    status: "active",
    openTasks: 0,
  };

  async function openConfirmation() {
    listTechnicians.mockResolvedValue([bram]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Uitschakelen" }));
    return screen.findByRole("dialog", { name: "Bram Claes uitschakelen?" });
  }

  it("asks for confirmation with the text of the design, and Annuleren changes nothing", async () => {
    const dialog = await openConfirmation();
    expect(
      within(dialog).getByText(
        "Hij kan zich dan niet meer aanmelden. Zijn afgewerkte taken en uren blijven bewaard.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deactivateTechnician).not.toHaveBeenCalled();
  });

  it("sends only the id, closes the dialog and confirms at the top", async () => {
    deactivateTechnician.mockResolvedValue({
      ok: true,
      message: "Bram Claes is uitgeschakeld. Zijn afgewerkte taken en uren blijven bewaard.",
    });
    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitschakelen" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Bram Claes is uitgeschakeld. Zijn afgewerkte taken en uren blijven bewaard.",
    );
    const data = deactivateTechnician.mock.calls[0][1] as FormData;
    expect([...data.keys()]).toEqual(["id"]);
    expect(data.get("id")).toBe("t4");
  });

  it("shows the reason in the dialog when the switch-off fails", async () => {
    deactivateTechnician.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitschakelen" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Dat is niet gelukt."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows 'Uitschakelen kan nog niet' at once for a technician with open tasks", async () => {
    await renderPage();
    fireEvent.click(
      within(screen.getByRole("row", { name: /Kevin/ })).getByRole("button", {
        name: "Uitschakelen",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Uitschakelen kan nog niet" });
    expect(dialog).toHaveTextContent(
      "Kevin Wouters heeft nog taken die niet afgewerkt zijn (6). Wijs die eerst aan een andere technieker toe.",
    );
    expect(within(dialog).getByRole("link", { name: "Toon zijn taken" })).toHaveAttribute(
      "href",
      "/tasks?technician=t1",
    );
    expect(within(dialog).queryByRole("button", { name: "Uitschakelen" })).not.toBeInTheDocument();
    expect(deactivateTechnician).not.toHaveBeenCalled();
  });

  it("replaces the confirmation by the refusal when the server finds open tasks after all", async () => {
    deactivateTechnician.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Uitschakelen kan nog niet. …",
      openTasks: 2,
    });
    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uitschakelen" }));

    const refusal = await screen.findByRole("dialog", { name: "Uitschakelen kan nog niet" });
    expect(refusal).toHaveTextContent("Bram Claes heeft nog taken die niet afgewerkt zijn (2).");
    expect(within(refusal).getByRole("link", { name: "Toon zijn taken" })).toBeInTheDocument();

    // Closing and opening again starts from what the list shows.
    // Only the footer button of the design: the corner cross is off in this dialog.
    fireEvent.click(within(refusal).getByRole("button", { name: "Sluiten" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Uitschakelen" }));
    expect(await screen.findByRole("dialog", { name: "Bram Claes uitschakelen?" })).toBeVisible();
  });
});
