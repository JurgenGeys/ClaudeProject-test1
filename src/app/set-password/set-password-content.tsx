import { redirect } from "next/navigation";

import { LOGIN_MESSAGES, SET_PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { INACTIVE_PATH, SET_PASSWORD_ERROR_UNAVAILABLE, homePathForRole } from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";
import { firstName } from "@/lib/person-name";

import { SetPasswordForm } from "./set-password-form";

const alertClass = "mt-6 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900";

/**
 * Decides what G2 shows. The form is only for an invited user whose password is still to be
 * chosen (the session that `/auth/confirm` created). Everybody else gets a message, or goes
 * on to their own start page; there is no way to see the form without a valid link.
 */
export async function SetPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error } = await searchParams;
  const state = await getAuthState();

  if (state.status === "authenticated") {
    redirect(homePathForRole(state.user.role));
  }
  if (state.status === "inactive") {
    redirect(INACTIVE_PATH);
  }

  if (state.status === "password-pending") {
    return (
      <>
        <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
          Welkom, {firstName(state.user.fullName)}
        </h1>
        <p className="mt-2 text-center text-muted-foreground">
          Kies een wachtwoord om de planning te gebruiken.
        </p>
        <SetPasswordForm />
      </>
    );
  }

  const unavailable = state.status === "unavailable" || error === SET_PASSWORD_ERROR_UNAVAILABLE;
  return (
    <>
      <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
        Wachtwoord instellen
      </h1>
      <div role="alert" className={alertClass}>
        {unavailable ? (
          <p className="font-medium">{LOGIN_MESSAGES.technicalProblem}</p>
        ) : (
          <>
            <p className="font-medium">{SET_PASSWORD_MESSAGES.inviteLinkInvalid}</p>
            <p className="mt-1">{SET_PASSWORD_MESSAGES.inviteLinkAdvice}</p>
          </>
        )}
      </div>
    </>
  );
}
