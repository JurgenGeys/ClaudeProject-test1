import { redirect } from "next/navigation";

import {
  INACTIVE_PATH,
  INVITE_EXPIRED_PATH,
  RESET_EXPIRED_PATH,
  SET_PASSWORD_INVITE_PATH,
  SET_PASSWORD_RESET_PATH,
  homePathForRole,
} from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";

import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * Decides what G3 shows. Somebody who is signed in does not need it and goes to their own
 * page, as on the login page; a restricted (invitation or recovery) session may only choose a
 * password and is sent there. Everybody else, also when Auth is unreachable, gets the form:
 * asking for a mail needs no session.
 */
export async function ForgotPasswordContent() {
  const state = await getAuthState();
  if (state.status === "authenticated") {
    redirect(homePathForRole(state.user.role));
  }
  if (state.status === "inactive") {
    redirect(INACTIVE_PATH);
  }
  if (state.status === "invite-expired") {
    redirect(INVITE_EXPIRED_PATH);
  }
  if (state.status === "password-pending") {
    redirect(SET_PASSWORD_INVITE_PATH);
  }
  if (state.status === "reset-expired") {
    redirect(RESET_EXPIRED_PATH);
  }
  if (state.status === "reset-pending") {
    redirect(SET_PASSWORD_RESET_PATH);
  }
  return <ForgotPasswordForm />;
}
