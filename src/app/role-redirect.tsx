import { redirect } from "next/navigation";

import { AuthUnavailable } from "@/components/auth/auth-unavailable";
import { pathForSignedOutVisitor } from "@/lib/auth/login-redirect";
import { INACTIVE_PATH, homePathForRole } from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";

/** Sends the visitor of `/` to the start page of their role, or to the login page. */
export async function RoleRedirect() {
  const state = await getAuthState();
  if (state.status === "unavailable") {
    return <AuthUnavailable />;
  }
  if (state.status === "unauthenticated") {
    redirect(await pathForSignedOutVisitor());
  }
  if (state.status === "inactive") {
    redirect(INACTIVE_PATH);
  }
  redirect(homePathForRole(state.user.role));
}
