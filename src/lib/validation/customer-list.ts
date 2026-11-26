import { z } from "zod";

import { CUSTOMER_SEARCH_MAX_LENGTH } from "@/lib/customers/limits";

/**
 * The query parameters of the customer list (design B5), read from the URL:
 *
 *   /customers?q=turnhout&page=2
 *
 * A URL can be typed or edited by anyone, so an invalid parameter is ignored (as if it was not
 * there) instead of failing the page.
 */
export type CustomerListParams = {
  /** The search text (trimmed), or `""` for all customers. */
  q: string;
  /** Requested page, from 1. The query clamps it to the last page. */
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const pageSchema = z
  .string()
  .regex(/^[1-9]\d{0,5}$/)
  .transform(Number);

export function parseCustomerListParams(raw: RawParams): CustomerListParams {
  const q = typeof raw.q === "string" ? raw.q.trim() : "";
  const page = typeof raw.page === "string" ? pageSchema.safeParse(raw.page) : undefined;
  return {
    // Too long to be a real search: ignored, like any other invalid parameter.
    q: q.length <= CUSTOMER_SEARCH_MAX_LENGTH ? q : "",
    page: page?.success ? page.data : 1,
  };
}

/** The URL of the customer list for these parameters; defaults are left out. */
export function customerListHref(params: Partial<CustomerListParams>): string {
  const query = new URLSearchParams();
  if (params.q) {
    query.set("q", params.q);
  }
  if (params.page && params.page > 1) {
    query.set("page", String(params.page));
  }
  const text = query.toString();
  return text ? `/customers?${text}` : "/customers";
}

/** A customer id from a URL: a UUID, or `null`. */
export function parseCustomerId(value: string): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
