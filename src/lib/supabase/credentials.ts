import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "./env";

/**
 * Supabase client that checks a password without keeping anything: no cookies, no stored
 * session. The login action first signs in with this client and looks at the profile, and
 * only then writes the session cookies (`setSession` on the server client). A refused
 * login therefore never touches the cookies, which matters because a Server Action that
 * changes cookies makes Next.js render the page again and the form would lose its message.
 * Publishable key only: it has no extra rights.
 */
export function createSupabaseCredentialsClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
