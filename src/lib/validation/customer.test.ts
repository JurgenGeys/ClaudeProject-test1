import { describe, expect, it } from "vitest";

import { customerSchema } from "./customer";
import { fieldErrors } from "./test-helpers";

describe("customerSchema", () => {
  it("accepts a customer with only a name; empty fields become null", () => {
    expect(customerSchema.parse({ name: "  Bakkerij De Gouden Korst " })).toEqual({
      name: "Bakkerij De Gouden Korst",
      street: null,
      postalCode: null,
      city: null,
      phone: null,
      email: null,
      notes: null,
    });
    expect(
      customerSchema.parse({
        name: "A",
        street: "",
        postalCode: " ",
        city: "",
        phone: "",
        email: "",
        notes: null,
      }),
    ).toMatchObject({ street: null, postalCode: null, city: null, phone: null, email: null });
  });

  it("accepts a complete customer", () => {
    expect(
      customerSchema.parse({
        name: "Bakkerij De Gouden Korst",
        street: "Kerkstraat 12",
        postalCode: "2310",
        city: "Rijkevorsel",
        phone: "03 123 45 67",
        email: "info@goudenkorst.be",
        notes: "Sleutel bij de buren op nr. 14",
      }),
    ).toMatchObject({ postalCode: "2310", email: "info@goudenkorst.be" });
  });

  it("requires a name", () => {
    for (const name of [undefined, "", "   "]) {
      expect(fieldErrors(customerSchema, { name })).toEqual({
        name: ["Vul de naam van de klant in."],
      });
    }
  });

  it("checks the postal code (4 digits) and the e-mail address when given", () => {
    expect(fieldErrors(customerSchema, { name: "A", postalCode: "23100" })).toEqual({
      postalCode: ["Vul een geldige postcode in (4 cijfers)."],
    });
    expect(fieldErrors(customerSchema, { name: "A", postalCode: "23a0" })).toEqual({
      postalCode: ["Vul een geldige postcode in (4 cijfers)."],
    });
    expect(fieldErrors(customerSchema, { name: "A", email: "geen-adres" })).toEqual({
      email: ["Dit e-mailadres is niet geldig. Controleer het of laat het leeg."],
    });
  });

  it("refuses absurdly long text", () => {
    expect(fieldErrors(customerSchema, { name: "a".repeat(201) })).toHaveProperty("name");
    expect(fieldErrors(customerSchema, { name: "a".repeat(200) })).toBeNull();
    expect(fieldErrors(customerSchema, { name: "A", notes: "x".repeat(5001) })).toHaveProperty(
      "notes",
    );
  });
});

describe("customerSchema: line endings", () => {
  it("turns CRLF in the remarks into \\n", () => {
    expect(customerSchema.parse({ name: "Klant", notes: "a\r\nb\rc" }).notes).toBe("a\nb\nc");
  });
});
