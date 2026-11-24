import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "./env";

/**
 * Supabase client with the secret key, which bypasses all Row Level Security. Only for
 * Auth administration on the server (inviting, banning and creating users). Never import
 * this from client code and never put the key in a `NEXT_PUBLIC_` variable (ADR-0002, rule 5).
 */
export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Copy .env.example to .env.local and fill in the secret key.",
    );
  }

  return createClient(url, secretKey, {
    // A server-side admin client has no user session to keep or refresh.
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
