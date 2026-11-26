/**
 * Limits of the customer search of the task form (design B2). Plain constants without imports,
 * so the Client Component of the picker and the server-only query use the same values.
 */

/** The picker shows at most this many results (design B2). */
export const CUSTOMER_SEARCH_LIMIT = 8;

/** A shorter text finds too much to be useful (as in the mockup). */
export const CUSTOMER_SEARCH_MIN_LENGTH = 2;

/** Customers per page of the customer list (B5). Same size as the task overview. */
export const CUSTOMER_PAGE_SIZE = 50;

/** Longest text the customer list or the picker searches for. */
export const CUSTOMER_SEARCH_MAX_LENGTH = 100;
