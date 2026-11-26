import { customerSchema, type CustomerInput } from "./customer";
import { parseCustomerId } from "./customer-list";

/**
 * The form of "Klant aanmaken / bewerken" (design B6) as the browser sends it: every field is
 * text. The names are the names of the form fields; `fieldErrors` of the action use the same
 * keys, so a message always ends up under the field it belongs to.
 */
export const CUSTOMER_FORM_FIELDS = [
  "name",
  "street",
  "postalCode",
  "city",
  "phone",
  "email",
  "notes",
] as const;
export type CustomerFormField = (typeof CUSTOMER_FORM_FIELDS)[number];

export type CustomerFormRaw = Record<CustomerFormField, string> & { id: string };
export type CustomerFieldErrors = Partial<Record<CustomerFormField, string>>;

export type CustomerFormParse =
  { ok: true; data: CustomerInput } | { ok: false; fieldErrors: CustomerFieldErrors };

/** Reads the known fields of the form as text (and the id of the customer, empty when new). */
export function readCustomerForm(formData: FormData): CustomerFormRaw {
  const raw = { id: "" } as CustomerFormRaw;
  for (const field of ["id", ...CUSTOMER_FORM_FIELDS] as const) {
    const value = formData.get(field);
    raw[field] = typeof value === "string" ? value : "";
  }
  return raw;
}

/** The customer id of a form that edits a customer; `null` when it is missing or not a UUID. */
export function customerIdOf(raw: Pick<CustomerFormRaw, "id">): string | null {
  return parseCustomerId(raw.id);
}

/**
 * Validates the fields of the customer on the server with `customerSchema` (the same schema as
 * the "Nieuwe klant" block of the task form). Reports every wrong field at once, one message per
 * field.
 */
export function parseCustomerForm(raw: CustomerFormRaw): CustomerFormParse {
  const parsed = customerSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  const fieldErrors: CustomerFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]) as CustomerFormField;
    if ((CUSTOMER_FORM_FIELDS as readonly string[]).includes(key) && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return { ok: false, fieldErrors };
}
