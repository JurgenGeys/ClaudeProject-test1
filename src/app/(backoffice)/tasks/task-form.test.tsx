import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createTask, searchCustomers } = vi.hoisted(() => ({
  createTask: vi.fn(),
  searchCustomers: vi.fn(),
}));
vi.mock("./actions", () => ({ createTask }));
vi.mock("../customers/actions", () => ({ searchCustomers }));

import { TaskForm } from "./task-form";

const technicians = [
  { id: "t1", fullName: "Kevin Wouters" },
  { id: "t2", fullName: "Jens Maes" },
];

const bakker = {
  id: "c1",
  name: "Bakkerij De Gouden Korst",
  street: "Gasthuisstraat 23",
  postalCode: "2300",
  city: "Turnhout",
  phone: "014 41 22 87",
};

beforeEach(() => {
  vi.resetAllMocks();
  createTask.mockResolvedValue(null);
  searchCustomers.mockResolvedValue({ ok: true, customers: [bakker] });
});

/** A field by its label; the asterisk of a required field is part of the label text. */
function labelPattern(label: string) {
  return new RegExp(`^${label}( \\*)?$`);
}
function field(label: string) {
  return screen.getByLabelText(labelPattern(label));
}
function findField(label: string) {
  return screen.findByLabelText(labelPattern(label));
}

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

/** The form data of the last submit, as the action received it. */
function submittedData(): FormData {
  const call = createTask.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![1] as FormData;
}

function submit() {
  return act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: "Taak bewaren" }).closest("form")!);
  });
}

async function chooseBakker() {
  type("Zoek een klant", "bak");
  fireEvent.click(await screen.findByRole("button", { name: /Bakkerij De Gouden Korst/ }));
}

describe("TaskForm: layout", () => {
  it("has the three blocks of design B2 with a visible label for every field", () => {
    render(<TaskForm technicians={technicians} />);
    for (const heading of ["1. Klant", "2. Locatie", "3. Taak"]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
    for (const label of [
      "Zoek een klant",
      "Straat en nummer *",
      "Postcode *",
      "Gemeente *",
      "Instructies *",
      "Datum *",
      "Startuur *",
      "Geschatte duur",
      "Technieker",
    ]) {
      expect(field(label.replace(" *", ""))).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Taak bewaren" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Annuleren" })).toHaveAttribute("href", "/tasks");
  });

  it("offers the three kinds of work as radio buttons without a default", () => {
    render(<TaskForm technicians={technicians} />);
    const group = screen.getByRole("radiogroup", { name: "Soort werk" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "inspection",
      "maintenance",
      "repair",
    ]);
    expect(within(group).getByLabelText("Nazicht")).not.toBeChecked();
    expect(within(group).getByLabelText("Onderhoud")).not.toBeChecked();
    expect(within(group).getByLabelText("Herstelling")).not.toBeChecked();
  });

  it("starts with 'Nog niet toewijzen' and lists only the technicians it was given", () => {
    render(<TaskForm technicians={technicians} />);
    const select = field("Technieker") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Nog niet toewijzen", "Kevin Wouters", "Jens Maes"]);
  });

  it("offers durations per quarter of an hour up to 8u00, and 'Niet ingevuld'", () => {
    render(<TaskForm technicians={technicians} />);
    const options = within(field("Geschatte duur")).getAllByRole("option");
    expect(options).toHaveLength(1 + 32);
    expect(options[0]).toHaveTextContent("Niet ingevuld");
    expect(options[1]).toHaveTextContent("0u15");
    expect(options[6]).toHaveTextContent("1u30");
    expect(options.at(-1)).toHaveTextContent("8u00");
    expect((options.at(-1) as HTMLOptionElement).value).toBe("480");
  });

  it("asks for a start time per quarter of an hour", () => {
    render(<TaskForm technicians={technicians} />);
    expect(field("Startuur")).toHaveAttribute("step", "900");
  });
});

describe("TaskForm: required fields", () => {
  it("tells a screen reader which fields are required, and only those", () => {
    render(<TaskForm technicians={technicians} />);
    for (const label of [
      "Zoek een klant",
      "Straat en nummer",
      "Postcode",
      "Gemeente",
      "Instructies",
      "Datum",
      "Startuur",
    ]) {
      expect(field(label)).toHaveAttribute("aria-required", "true");
    }
    expect(screen.getByRole("radiogroup", { name: "Soort werk" })).toHaveAttribute(
      "aria-required",
      "true",
    );
    for (const label of ["Geschatte duur", "Technieker"]) {
      expect(field(label)).not.toHaveAttribute("aria-required");
    }
  });

  it("marks the name of a new customer as required, and the optional fields not", () => {
    render(<TaskForm technicians={technicians} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe klant" }));
    expect(field("Naam")).toHaveAttribute("aria-required", "true");
    for (const label of ["Telefoon", "E-mail", "Opmerkingen"]) {
      expect(field(label)).not.toHaveAttribute("aria-required");
    }
  });
});

describe("TaskForm: sending", () => {
  it("sends what was typed, as text, with the existing-customer mode", async () => {
    render(<TaskForm technicians={technicians} />);
    await chooseBakker();
    type("Instructies", "Jaarlijks onderhoud");
    fireEvent.click(field("Onderhoud"));
    type("Datum", "2030-03-15");
    type("Startuur", "14:15");
    type("Geschatte duur", "90");
    type("Technieker", "t1");
    await submit();

    expect(createTask).toHaveBeenCalledTimes(1);
    const data = submittedData();
    expect(Object.fromEntries(data)).toMatchObject({
      customerMode: "existing",
      customerId: "c1",
      locationStreet: "Gasthuisstraat 23",
      locationPostalCode: "2300",
      locationCity: "Turnhout",
      workType: "maintenance",
      instructions: "Jaarlijks onderhoud",
      scheduledDate: "2030-03-15",
      startTime: "14:15",
      estimatedMinutes: "90",
      assigneeId: "t1",
    });
  });

  it("sends 'Nog niet toewijzen' and no duration as empty values", async () => {
    render(<TaskForm technicians={technicians} />);
    await submit();
    expect(Object.fromEntries(submittedData())).toMatchObject({
      assigneeId: "",
      estimatedMinutes: "",
    });
    expect(submittedData().has("workType")).toBe(false);
  });

  it("shows that it is busy and does not send twice while it waits", async () => {
    let finish!: (value: null) => void;
    createTask.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<TaskForm technicians={technicians} />);
    await submit();
    const button = await screen.findByRole("button", { name: "Bezig met bewaren…" });
    expect(button).toBeDisabled();
    await act(async () => finish(null));
    expect(screen.getByRole("button", { name: "Taak bewaren" })).toBeEnabled();
  });
});

describe("TaskForm: refused", () => {
  const fieldErrors = {
    customerId: "Kies een klant of maak een nieuwe klant aan.",
    locationStreet: "Vul de straat en het huisnummer in.",
    workType: "Kies het soort werk: nazicht, onderhoud of herstelling.",
    instructions: "Beschrijf wat de technieker moet doen.",
    scheduledDate: "Kies een datum.",
  };

  it("shows a summary with the focus, a message under every field and marks the fields invalid", async () => {
    createTask.mockResolvedValue({ ok: false, fieldErrors });
    render(<TaskForm technicians={technicians} />);
    await submit();

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("De taak is niet bewaard. Vul de 5 gemarkeerde velden in.");
    expect(summary).toHaveFocus();

    expect(screen.getByText(fieldErrors.customerId)).toBeInTheDocument();
    const street = field("Straat en nummer");
    expect(street).toHaveAttribute("aria-invalid", "true");
    expect(street).toHaveAccessibleDescription(fieldErrors.locationStreet);
    expect(field("Datum")).toHaveAccessibleDescription("Kies een datum.");
    expect(field("Instructies")).toHaveAccessibleDescription(
      /De eerste regel verschijnt als korte omschrijving in de lijsten\. Beschrijf wat de technieker moet doen\./,
    );
    expect(screen.getByRole("radiogroup", { name: "Soort werk" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("radiogroup", { name: "Soort werk" })).toHaveAccessibleDescription(
      fieldErrors.workType,
    );
    // Fields without an error are not marked.
    expect(field("Postcode")).not.toHaveAttribute("aria-invalid");
  });

  it("says 'Vul het gemarkeerde veld in.' for one field", async () => {
    createTask.mockResolvedValue({ ok: false, fieldErrors: { startTime: "Kies een startuur." } });
    render(<TaskForm technicians={technicians} />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "De taak is niet bewaard. Vul het gemarkeerde veld in.",
    );
  });

  it("keeps everything that was typed and chosen after a refusal", async () => {
    createTask.mockResolvedValue({
      ok: false,
      fieldErrors: { startTime: "Kies een startuur." },
    });
    render(<TaskForm technicians={technicians} />);
    await chooseBakker();
    type("Instructies", "Jaarlijks onderhoud");
    type("Straat en nummer", "Kerkstraat 1");
    fireEvent.click(field("Herstelling"));
    type("Datum", "2030-03-15");
    type("Geschatte duur", "120");
    type("Technieker", "t2");
    await submit();
    await screen.findByRole("alert");

    expect(field("Straat en nummer")).toHaveValue("Kerkstraat 1");
    expect(field("Instructies")).toHaveValue("Jaarlijks onderhoud");
    expect(field("Herstelling")).toBeChecked();
    expect(field("Datum")).toHaveValue("2030-03-15");
    expect(field("Geschatte duur")).toHaveValue("120");
    expect(field("Technieker")).toHaveValue("t2");
    // The chosen customer is still chosen.
    expect(screen.getByText("Bakkerij De Gouden Korst")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Andere klant kiezen" })).toBeInTheDocument();
  });

  it("shows a form-level problem in the summary, without marking fields", async () => {
    createTask.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    render(<TaskForm technicians={technicians} />);
    await submit();
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent(
      "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    );
    expect(summary).toHaveFocus();
    expect(document.querySelector("[aria-invalid]")).toBeNull();
  });

  it("puts the 'technician no longer active' message under the technician field", async () => {
    createTask.mockResolvedValue({
      ok: false,
      fieldErrors: {
        assigneeId: "Kevin Wouters is niet meer actief. Kies een andere technieker.",
      },
    });
    render(<TaskForm technicians={technicians} />);
    await submit();
    const select = await findField("Technieker");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription(
      /Kevin Wouters is niet meer actief\. Kies een andere technieker\./,
    );
  });
});

describe("TaskForm: date", () => {
  it("warns about a date in the past, but does not block it", async () => {
    render(<TaskForm technicians={technicians} />);
    type("Datum", "2020-01-01");
    expect(screen.getByText("Deze datum ligt in het verleden.")).toBeInTheDocument();
    expect(field("Datum")).toHaveAccessibleDescription("Deze datum ligt in het verleden.");
    await submit();
    expect(createTask).toHaveBeenCalledTimes(1);
    type("Datum", "2999-01-01");
    expect(screen.queryByText("Deze datum ligt in het verleden.")).not.toBeInTheDocument();
    type("Datum", "");
    expect(screen.queryByText("Deze datum ligt in het verleden.")).not.toBeInTheDocument();
  });
});

describe("TaskForm: customer", () => {
  it("looks up a customer, fills in the location and shows the customer", async () => {
    render(<TaskForm technicians={technicians} />);
    type("Zoek een klant", "bak");
    const result = await screen.findByRole("button", { name: /Bakkerij De Gouden Korst/ });
    expect(searchCustomers).toHaveBeenCalledWith("bak");
    expect(screen.getByText("1 klant gevonden.")).toBeInTheDocument();
    expect(result).toHaveTextContent("Gasthuisstraat 23, 2300 Turnhout · 014 41 22 87");

    fireEvent.click(result);
    expect(field("Straat en nummer")).toHaveValue("Gasthuisstraat 23");
    expect(field("Postcode")).toHaveValue("2300");
    expect(field("Gemeente")).toHaveValue("Turnhout");
    expect(screen.getByRole("button", { name: "Andere klant kiezen" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Zoek een klant")).not.toBeVisible();
  });

  it("lets the user change the address for this task only, and choose another customer", async () => {
    render(<TaskForm technicians={technicians} />);
    await chooseBakker();
    type("Straat en nummer", "Andere straat 5");
    await submit();
    expect(Object.fromEntries(submittedData())).toMatchObject({
      customerId: "c1",
      locationStreet: "Andere straat 5",
    });

    fireEvent.click(screen.getByRole("button", { name: "Andere klant kiezen" }));
    expect(field("Zoek een klant")).toBeVisible();
    expect(field("Zoek een klant")).toHaveValue("");
    await submit();
    expect(Object.fromEntries(submittedData())).toMatchObject({
      customerMode: "existing",
      customerId: "",
    });
  });

  it("does not search for one character, and says when nothing is found", async () => {
    render(<TaskForm technicians={technicians} />);
    type("Zoek een klant", "b");
    expect(searchCustomers).not.toHaveBeenCalled();

    searchCustomers.mockResolvedValue({ ok: true, customers: [] });
    type("Zoek een klant", "xyz");
    expect(await screen.findByText("Geen klant gevonden voor 'xyz'.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Gevonden klanten" })).not.toBeInTheDocument();
  });

  it("says so when the search fails", async () => {
    searchCustomers.mockResolvedValue({
      ok: false,
      message: "Je hebt geen toegang om dit te doen.",
    });
    render(<TaskForm technicians={technicians} />);
    type("Zoek een klant", "bak");
    expect(await screen.findByText("Je hebt geen toegang om dit te doen.")).toBeInTheDocument();
  });

  it("only shows the answer to the latest search", async () => {
    let answerFirst!: (value: unknown) => void;
    searchCustomers.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    render(<TaskForm technicians={technicians} />);
    type("Zoek een klant", "ba");
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledWith("ba"));
    searchCustomers.mockResolvedValueOnce({
      ok: true,
      customers: [{ ...bakker, id: "c2", name: "Bakkerij Van Loon" }],
    });
    type("Zoek een klant", "bak");
    expect(await screen.findByRole("button", { name: /Bakkerij Van Loon/ })).toBeInTheDocument();
    await act(async () => answerFirst({ ok: true, customers: [bakker] }));
    expect(screen.queryByRole("button", { name: /De Gouden Korst/ })).not.toBeInTheDocument();
  });

  it("moves the focus to the first result with the arrow key", async () => {
    render(<TaskForm technicians={technicians} />);
    type("Zoek een klant", "bak");
    const result = await screen.findByRole("button", { name: /Bakkerij De Gouden Korst/ });
    fireEvent.keyDown(field("Zoek een klant"), { key: "ArrowDown" });
    expect(result).toHaveFocus();
  });

  it("opens the fields of a new customer, which are sent with the form", async () => {
    render(<TaskForm technicians={technicians} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe klant" }));
    await waitFor(() => expect(field("Naam")).toHaveFocus());
    expect(screen.getByText(/Het adres vul je hieronder in bij "Locatie"\./)).toBeInTheDocument();
    type("Naam", "Bakkerij Nieuw");
    type("Telefoon", "0470 12 34 56");
    type("E-mail", "info@nieuw.be");
    type("Opmerkingen", "Sleutel bij de buren");
    await submit();
    expect(Object.fromEntries(submittedData())).toMatchObject({
      customerMode: "new",
      customerId: "",
      newCustomerName: "Bakkerij Nieuw",
      newCustomerPhone: "0470 12 34 56",
      newCustomerEmail: "info@nieuw.be",
      newCustomerNotes: "Sleutel bij de buren",
    });
  });

  it("goes back to searching and keeps what was typed for the new customer", async () => {
    render(<TaskForm technicians={technicians} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe klant" }));
    type("Naam", "Bakkerij Nieuw");
    fireEvent.click(screen.getByRole("button", { name: "Toch een bestaande klant zoeken" }));
    expect(field("Zoek een klant")).toBeVisible();
    await submit();
    expect(submittedData().get("customerMode")).toBe("existing");

    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe klant" }));
    expect(field("Naam")).toHaveValue("Bakkerij Nieuw");
  });

  it("shows the errors of the new customer under their fields", async () => {
    createTask.mockResolvedValue({
      ok: false,
      fieldErrors: {
        newCustomerName: "Vul de naam van de klant in.",
        newCustomerEmail: "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
      },
    });
    render(<TaskForm technicians={technicians} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe klant" }));
    await submit();
    await screen.findByRole("alert");
    expect(field("Naam")).toHaveAttribute("aria-invalid", "true");
    expect(field("Naam")).toHaveAccessibleDescription("Vul de naam van de klant in.");
    expect(field("E-mail")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the customer error under the search field, and under the chosen customer", async () => {
    createTask.mockResolvedValue({
      ok: false,
      fieldErrors: { customerId: "Kies een klant of maak een nieuwe klant aan." },
    });
    render(<TaskForm technicians={technicians} />);
    await submit();
    const search = await findField("Zoek een klant");
    expect(search).toHaveAttribute("aria-invalid", "true");
    expect(search).toHaveAccessibleDescription(/Kies een klant of maak een nieuwe klant aan\./);
  });
});
