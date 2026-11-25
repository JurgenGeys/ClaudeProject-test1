"use server";

import { z } from "zod";

import { getDb } from "@/db/client";
import { authFailureMessage } from "@/lib/auth/action-errors";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { AuthError, requireRole } from "@/lib/auth/session";
import { findCustomers, type CustomerSearchResult } from "@/lib/customers/search";

/** Result of the customer search of the task form (design B2). */
export type SearchCustomersResult =
  { ok: true; customers: CustomerSearchResult[] } | { ok: false; message: string };

/** A search text from the browser: text, and short enough to be a search. */
const searchTextSchema = z.string().max(100);

/**
 * Searches customers by name, phone number or city for the picker of B2 (at most 8 results).
 * Only the text comes from the browser; it is validated and used as a plain value in the query.
 * The full customer list and the other customer actions (B5, B6) are built in BT-18.
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
