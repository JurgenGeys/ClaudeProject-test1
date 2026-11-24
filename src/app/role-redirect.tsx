import { redirect } from "next/navigation";

import { INACTIVE_PATH, LOGIN_PATH, homePathForRole } from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";

/** Sends the visitor of `/` to the start page of their role, or to the login page. */
export async function RoleRedirect(): Promise<never> {
  const state = await getAuthState();
  if (state.status === "unauthenticated") {
    redirect(LOGIN_PATH);
  }
  if (state.status === "inactive") {
    redirect(INACTIVE_PATH);
  }
  redirect(homePathForRole(state.user.role));
}
