"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole, type CurrentUser } from "@/lib/auth/session";
import { CUSTOMER_SEARCH_MAX_LENGTH } from "@/lib/customers/limits";
import { CUSTOMER_ACTION_MESSAGES } from "@/lib/customers/messages";
import { insertCustomer, updateCustomerFields } from "@/lib/customers/save";
import { findCustomers, type CustomerSearchResult } from "@/lib/customers/search";
import {
  customerIdOf,
  parseCustomerForm,
  readCustomerForm,
  type CustomerFieldErrors,
} from "@/lib/validation/customer-form";

/** Result of the customer search of the task form (design B2). */
export type SearchCustomersResult =
  { ok: true; customers: CustomerSearchResult[] } | { ok: false; message: string };

/** A search text from the browser: text, and short enough to be a search. */
const searchTextSchema = z.string().max(CUSTOMER_SEARCH_MAX_LENGTH);

/**
 * Searches customers by name, phone number or city for the picker of B2 (at most 8 results).
 * Only the text comes from the browser; it is validated and used as a plain value in the query.
 */
export async function searchCustomers(text: string): Promise<SearchCustomersResult> {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: authFailureMessage(error) };
    }
    throw error;
  }

  const parsed = searchTextSchema.safeParse(text);
  if (!parsed.success) {
    return { ok: true, customers: [] };
  }
  try {
    return { ok: true, customers: await findCustomers(getDb(), parsed.data) };
  } catch (error) {
    // Only the kind of error: the text of an error can contain what was searched for.
    console.error(
      "Searching customers failed:",
      error instanceof Error ? error.name : typeof error,
    );
    return { ok: false, message: LOGIN_MESSAGES.technicalProblem };
  }
}

/**
 * Result of `createCustomer` and `updateCustomer` when the customer was not saved. A saved
 * customer redirects instead, so there is no success state. The form keeps what was typed
 * itself; nothing is echoed back.
 */
export type CustomerFormState = null | {
  ok: false;
  fieldErrors: CustomerFieldErrors;
  /** A problem that does not belong to one field (technical problem, no access, unknown customer). */
  formError?: string;
};

function refused(formError: string): NonNullable<CustomerFormState> {
  return { ok: false, fieldErrors: {}, formError };
}

/** Only the kind of error (and the Postgres code): the message of an error can hold form data. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return `${error instanceof Error ? error.name : "error"} ${String((error as { code: unknown }).code)}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Saves a new customer (design B6; BT-18). `requireRole("backoffice")` first, then Zod
 * validation on the server (`customerSchema`), then the insert (`created_by` = the user). After
 * a save the user continues to the customer page with "Klant bewaard.".
 */
export async function createCustomer(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  let actor: CurrentUser;
  try {
    actor = await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const parsed = parseCustomerForm(readCustomerForm(formData));
  if (!parsed.ok) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  let id: string;
  try {
    id = await insertCustomer(getDb(), actor.id, parsed.data);
  } catch (error) {
    console.error("Saving a customer failed:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }

  revalidatePath("/customers");
  // `redirect()` throws, so it stays outside the try/catch above.
  redirect(`/customers/${id}?saved=1`);
}

/**
 * Saves the changes to a customer (design B6). Same order as `createCustomer`; the customer is
 * found by the id the form was opened with (a UUID, checked). Existing tasks keep their own
 * location. The last save wins: B6 has no version check.
 */
export async function updateCustomer(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      return refused(authFailureMessage(error));
    }
    throw error;
  }

  const raw = readCustomerForm(formData);
  const id = customerIdOf(raw);
  if (id === null) {
    return refused(CUSTOMER_ACTION_MESSAGES.notFound);
  }
  const parsed = parseCustomerForm(raw);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  let found: boolean;
  try {
    found = await updateCustomerFields(getDb(), id, parsed.data);
  } catch (error) {
    console.error("Saving a customer failed:", describeError(error));
    return refused(LOGIN_MESSAGES.technicalProblem);
  }
  if (!found) {
    return refused(CUSTOMER_ACTION_MESSAGES.notFound);
  }

  revalidatePath("/customers");
  redirect(`/customers/${id}?saved=1`);
}
