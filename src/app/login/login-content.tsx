import { redirect } from "next/navigation";

import { pathForSignedOutVisitor } from "@/lib/auth/login-redirect";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import {
  INACTIVE_PATH,
  LOGIN_PATH,
  INVITE_EXPIRED_PATH,
  LOGIN_REASON_DISABLED,
  RESET_EXPIRED_PATH,
  SET_PASSWORD_INVITE_PATH,
  SET_PASSWORD_RESET_PATH,
  homePathForRole,
} from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

/**
 * Decides what the login page shows. The proxy does not do this: it cannot verify the
 * session with the Auth server, and a redirect there could loop with `/`.
 */
export async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { reason } = await searchParams;
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
  if (state.status === "unauthenticated") {
    // Leftover cookies of a session that no longer exists are removed first. After that
    // there are none, so this cannot repeat.
    const next = await pathForSignedOutVisitor();
    if (next !== LOGIN_PATH) {
      redirect(next);
    }
  }

  const notice =
    state.status === "unavailable"
      ? LOGIN_MESSAGES.technicalProblem
      : reason === LOGIN_REASON_DISABLED
        ? LOGIN_MESSAGES.accountDisabled
        : undefined;
  return <LoginForm notice={notice} />;
}
