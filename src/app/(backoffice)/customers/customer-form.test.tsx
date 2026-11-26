import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCustomer, updateCustomer } = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("./actions", () => ({ createCustomer, updateCustomer }));

import { CustomerForm } from "./customer-form";

const existing = {
  id: "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11",
  name: "Bakkerij De Gouden Korst",
  street: "Gasthuisstraat 23",
  postalCode: "2300",
  city: "Turnhout",
  phone: "014 41 22 87",
  email: "info@bakkerijgoudenkorst.be",
  notes: "Ingang via de achterdeur.",
};

beforeEach(() => {
  vi.resetAllMocks();
  createCustomer.mockResolvedValue(null);
  updateCustomer.mockResolvedValue(null);
});

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}( \\*)?$`));
const submit = () =>
  act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: "Klant bewaren" }).closest("form")!);
  });

describe("CustomerForm: layout", () => {
  it("has a visible label for every field and marks only the name as required", () => {
    render(<CustomerForm />);
    for (const label of [
      "Naam",
      "Straat en nummer",
      "Postcode",
      "Gemeente",
      "Telefoon",
      "E-mail",
      "Opmerkingen",
    ]) {
      expect(field(label)).toBeInTheDocument();
    }
    expect(field("Naam")).toHaveAttribute("aria-required", "true");
    expect(field("Postcode")).not.toHaveAttribute("aria-required");
    expect(field("Opmerkingen")).toHaveAccessibleDescription(
      "De technieker ziet deze opmerking bij elke taak voor deze klant.",
    );
    expect(screen.getByRole("button", { name: "Klant bewaren" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Annuleren" })).toHaveAttribute("href", "/customers");
  });

  it("is empty for a new customer and says nothing about tasks", () => {
    render(<CustomerForm />);
    expect(field("Naam")).toHaveValue("");
    expect(document.querySelector('input[name="id"]')).toBeNull();
    expect(screen.queryByText(/past de locatie van bestaande taken niet aan/)).toBeNull();
  });

  it("shows the saved customer when editing, with the id and the note about tasks", () => {
    render(<CustomerForm customer={existing} />);
    expect(field("Naam")).toHaveValue("Bakkerij De Gouden Korst");
    expect(field("Postcode")).toHaveValue("2300");
    expect(field("Telefoon")).toHaveValue("014 41 22 87");
    expect(field("Opmerkingen")).toHaveValue("Ingang via de achterdeur.");
    expect(document.querySelector<HTMLInputElement>('input[name="id"]')?.value).toBe(existing.id);
    expect(
      screen.getByText("Een adreswijziging hier past de locatie van bestaande taken niet aan."),
    ).toBeInTheDocument();
  });

  it("shows empty fields of a saved customer as empty", () => {
    render(
      <CustomerForm
        customer={{ ...existing, street: null, postalCode: null, phone: null, notes: null }}
      />,
    );
    expect(field("Straat en nummer")).toHaveValue("");
    expect(field("Opmerkingen")).toHaveValue("");
  });
});

describe("CustomerForm: sending", () => {
  it("sends the typed values to createCustomer for a new customer", async () => {
    render(<CustomerForm />);
    fireEvent.change(field("Naam"), { target: { value: "Fam. Hermans" } });
    fireEvent.change(field("Gemeente"), { target: { value: "Vosselaar" } });
    await submit();
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(updateCustomer).not.toHaveBeenCalled();
    const data = createCustomer.mock.calls[0][1] as FormData;
    expect(data.get("name")).toBe("Fam. Hermans");
    expect(data.get("city")).toBe("Vosselaar");
    expect(data.get("id")).toBeNull();
  });

  it("sends the id to updateCustomer when editing", async () => {
    render(<CustomerForm customer={existing} />);
    await submit();
    expect(updateCustomer).toHaveBeenCalledTimes(1);
    expect(createCustomer).not.toHaveBeenCalled();
    expect((updateCustomer.mock.calls[0][1] as FormData).get("id")).toBe(existing.id);
  });
});

describe("CustomerForm: refusals", () => {
  it("shows a summary with the focus and a message under every wrong field", async () => {
    createCustomer.mockResolvedValue({
      ok: false,
      fieldErrors: {
        name: "Vul de naam van de klant in.",
        email: "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
      },
    });
    render(<CustomerForm />);
    fireEvent.change(field("E-mail"), { target: { value: "geen-mail" } });
    await submit();

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent(
      "De klant is niet bewaard. Verbeter de 2 gemarkeerde velden.",
    );
    expect(summary).toHaveFocus();
    expect(field("Naam")).toHaveAttribute("aria-invalid", "true");
    expect(field("Naam")).toHaveAccessibleDescription("Vul de naam van de klant in.");
    expect(field("E-mail")).toHaveAccessibleDescription(
      "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
    );
    expect(field("Telefoon")).not.toHaveAttribute("aria-invalid");
    // A refused form keeps what was typed.
    expect(field("E-mail")).toHaveValue("geen-mail");
  });

  it("uses the singular for one wrong field", async () => {
    createCustomer.mockResolvedValue({
      ok: false,
      fieldErrors: { name: "Vul de naam van de klant in." },
    });
    render(<CustomerForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "De klant is niet bewaard. Verbeter het gemarkeerde veld.",
    );
  });

  it("shows only the message of the problem for a refusal without a field", async () => {
    updateCustomer.mockResolvedValue({
      ok: false,
      fieldErrors: {},
      formError: "Deze klant bestaat niet (meer).",
    });
    render(<CustomerForm customer={existing} />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Deze klant bestaat niet (meer).");
    expect(screen.getByRole("alert")).not.toHaveTextContent("niet bewaard");
  });

  it("keeps the remarks hint described next to an error", async () => {
    createCustomer.mockResolvedValue({
      ok: false,
      fieldErrors: { notes: "Deze tekst is te lang. Maak hem korter." },
    });
    render(<CustomerForm />);
    await submit();
    await screen.findByRole("alert");
    expect(field("Opmerkingen")).toHaveAccessibleDescription(
      "De technieker ziet deze opmerking bij elke taak voor deze klant. Deze tekst is te lang. Maak hem korter.",
    );
  });
});
