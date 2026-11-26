import { describe, expect, it } from "vitest";

import { CUSTOMER_MESSAGES } from "./messages";
import { customerIdOf, parseCustomerForm, readCustomerForm } from "./customer-form";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

describe("readCustomerForm", () => {
  it("reads the known fields as text and ignores everything else", () => {
    const raw = readCustomerForm(
      formData({ name: "Apotheek Nijs", createdBy: "someone", status: "x", id: "abc" }),
    );
    expect(raw).toEqual({
      id: "abc",
      name: "Apotheek Nijs",
      street: "",
      postalCode: "",
      city: "",
      phone: "",
      email: "",
      notes: "",
    });
  });

  it("reads a file as an empty field", () => {
    const data = new FormData();
    data.set("name", new File(["x"], "x.txt"));
    expect(readCustomerForm(data).name).toBe("");
  });
});

describe("customerIdOf", () => {
  it("is the id when it is a UUID, otherwise null", () => {
    const id = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";
    expect(customerIdOf({ id })).toBe(id);
    expect(customerIdOf({ id: "" })).toBeNull();
    expect(customerIdOf({ id: "1; drop table" })).toBeNull();
  });
});

describe("parseCustomerForm", () => {
  it("accepts a customer with only a name; the empty fields become null", () => {
    const parsed = parseCustomerForm(readCustomerForm(formData({ name: " Fam. Hermans " })));
    expect(parsed).toEqual({
      ok: true,
      data: {
        name: "Fam. Hermans",
        street: null,
        postalCode: null,
        city: null,
        phone: null,
        email: null,
        notes: null,
      },
    });
  });

  it("reports every wrong field at once, under the key of the form field (design B6)", () => {
    const parsed = parseCustomerForm(
      readCustomerForm(formData({ name: " ", postalCode: "23", email: "geen-mail" })),
    );
    expect(parsed).toEqual({
      ok: false,
      fieldErrors: {
        name: CUSTOMER_MESSAGES.nameRequired,
        postalCode: CUSTOMER_MESSAGES.postalCodeInvalid,
        email: CUSTOMER_MESSAGES.emailInvalid,
      },
    });
  });

  it("reports a text that is too long", () => {
    const parsed = parseCustomerForm(
      readCustomerForm(formData({ name: "A", notes: "x".repeat(5001) })),
    );
    expect(parsed).toMatchObject({ ok: false, fieldErrors: { notes: CUSTOMER_MESSAGES.tooLong } });
  });
});
