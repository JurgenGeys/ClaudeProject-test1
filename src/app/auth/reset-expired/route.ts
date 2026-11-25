import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { recoverySessions } from "@/db/schema";
import { endLocalSession } from "@/lib/auth/login-redirect";
import {
  SET_PASSWORD_ERROR_EXPIRED,
  SET_PASSWORD_MODE_RESET,
  SET_PASSWORD_PATH,
} from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where a page sends a user whose temporary "wachtwoord vergeten" session is older than 24
 * hours. Like `/auth/invite-expired`: a Server Component cannot remove cookies, a route handler
 * can. It ends the session and shows G2 (mode reset) with "De link is verlopen. Vraag een
 * nieuwe link aan."
 *
 * It only signs out when the session really has expired, so a crafted link cannot sign
 * anybody else out. Anyone else is sent on to the start page.
 */
export async function GET(request: NextRequest) {
  const state = await getAuthState();
  if (state.status !== "reset-expired") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Also removes the cookies when Auth cannot be reached; otherwise the session would stay and
  // this page could send the visitor round in circles.
  await endLocalSession(await createSupabaseServerClient());

  // The row goes only after the session has ended (deleting an expired row of a living session
  // would turn it into a normal one), and only the row of this very session.
  try {
    await getDb().delete(recoverySessions).where(eq(recoverySessions.sessionId, state.sessionId));
  } catch (error) {
    console.error(
      "Removing an expired recovery session failed:",
      error instanceof Error ? error.name : typeof error,
    );
  }

  return NextResponse.redirect(
    new URL(
      `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_RESET}&error=${SET_PASSWORD_ERROR_EXPIRED}`,
      request.url,
    ),
  );
}
