import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { getSupabasePublicEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and route handlers. It reads and
 * writes the session in the request cookies and runs with the rights of the signed-in user.
 * Create one per request; never keep it in a module-level variable.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  // The Auth client reads the clock (`Date.now()`) as soon as it is created, to check whether
  // the session has expired. Next.js also renders pages ahead of the request (runtime
  // prerender for prefetching), where cookies are known but the clock is not allowed.
  // `connection()` stops that prerender here; at a real request it resolves immediately.
  await connection();
  const { url, publishableKey } = getSupabasePublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // The second argument (no-cache headers for responses that set session cookies) is not
      // used on purpose: Next.js cannot set response headers from here, and it already marks
      // every dynamic response that sets cookies as not cacheable. The proxy, which does
      // control its response, does set those headers (`src/lib/supabase/proxy.ts`).
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
