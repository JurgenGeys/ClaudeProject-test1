import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "./env";

/**
 * Supabase client for Client Components. ADR-0002, rule 1: only for signing in, signing
 * out, session handling and requesting a password link. Never for reading or writing data.
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient(url, publishableKey);
}
