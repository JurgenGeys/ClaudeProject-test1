import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { accessRedirect } from "@/lib/auth/routes";

import { getSupabasePublicEnv } from "./env";

/**
 * The work of `src/proxy.ts`, kept here so it can be tested:
 * 1. Refresh the Supabase session when the access token has expired and write the new
 *    cookies to both the request (so pages see them) and the response (so the browser does).
 * 2. Optimistic access check: no session on a protected page means redirect to `/login`.
 *    Signed-in users on `/login` are handled by the login page itself (see `accessRedirect`).
 *
 * Only the session is checked here, with `getClaims()` (the token signature is verified;
 * no database access in the proxy). Role and "account deactivated" are checked per request
 * by `requireRole` in the layouts, pages and Server Actions.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  // Headers the Supabase client asks for when it sets cookies (no caching of session cookies).
  let cacheHeaders: Record<string, string> = {};

  const { url, publishableKey } = getSupabasePublicEnv();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        cacheHeaders = { ...cacheHeaders, ...headers };
        for (const [key, value] of Object.entries(cacheHeaders)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Nothing may run between creating the client and this call: it is what refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const target = accessRedirect({
    pathname: request.nextUrl.pathname,
    signedIn,
  });
  if (!target) {
    return response;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = target;
  redirectUrl.search = "";
  const redirectResponse = NextResponse.redirect(redirectUrl);
  // Keep a refreshed session (cookies) and the no-cache headers on the redirect as well.
  for (const cookie of response.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  for (const [key, value] of Object.entries(cacheHeaders)) {
    redirectResponse.headers.set(key, value);
  }
  return redirectResponse;
}
