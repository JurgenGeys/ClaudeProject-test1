import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and route handlers. It reads and
 * writes the session in the request cookies and runs with the rights of the signed-in user.
 * Create one per request; never keep it in a module-level variable.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: the proxy (BT-03)
          // refreshes the session, and Server Actions and route handlers can write them.
        }
      },
    },
  });
}
