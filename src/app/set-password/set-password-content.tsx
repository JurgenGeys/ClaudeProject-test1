import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  LOGIN_MESSAGES,
  RESET_PASSWORD_MESSAGES,
  SET_PASSWORD_MESSAGES,
} from "@/lib/auth/messages";
import {
  FORGOT_PASSWORD_PATH,
  INACTIVE_PATH,
  INVITE_EXPIRED_PATH,
  RESET_EXPIRED_PATH,
  SET_PASSWORD_ERROR_EXPIRED,
  SET_PASSWORD_ERROR_UNAVAILABLE,
  SET_PASSWORD_MODE_RESET,
  homePathForRole,
} from "@/lib/auth/routes";
import { getAuthState } from "@/lib/auth/session";
import { firstName } from "@/lib/person-name";

import { cancelPasswordReset } from "./actions";
import { SetPasswordForm } from "./set-password-form";

const alertClass = "mt-6 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900";

/**
 * Decides what G2 shows. The form is only for a session that `/auth/confirm` created: an invited
 * user whose password is still to be chosen (mode invite), or somebody who followed a "wachtwoord
 * vergeten" link (mode reset). Which of the two follows from the session, not from `?mode=`; the
 * query only decides the wording of the message for a visitor without such a session. Everybody
 * else gets a message, or goes on to their own start page; there is no way to see the form
 * without a valid link.
 */
export async function SetPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error, mode } = await searchParams;
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

  if (state.status === "reset-expired") {
    redirect(RESET_EXPIRED_PATH);
  }

  if (state.status === "reset-pending") {
    return (
      <>
        <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
          Nieuw wachtwoord kiezen
        </h1>
        <p className="mt-2 text-center text-muted-foreground">
          Kies een nieuw wachtwoord voor {state.user.email}.
        </p>
        <SetPasswordForm />
        {/* Leaves without choosing a password: ends the recovery session (design G2). */}
        <form action={cancelPasswordReset} className="mt-3">
          <Button type="submit" variant="outline" className="h-11 w-full text-base">
            Annuleren
          </Button>
        </form>
      </>
    );
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
        {/* Leaves without choosing a password: ends the temporary session (decision Jurgen, 25/11/2026). */}
        <form action={signOut} className="mt-3">
          <Button type="submit" variant="outline" className="h-11 w-full text-base">
            Annuleren
          </Button>
        </form>
      </>
    );
  }

  const unavailable = state.status === "unavailable" || error === SET_PASSWORD_ERROR_UNAVAILABLE;
  const expired = !unavailable && error === SET_PASSWORD_ERROR_EXPIRED;
  const isReset = mode === SET_PASSWORD_MODE_RESET;
  return (
    <>
      <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
        Wachtwoord instellen
      </h1>
      <div role="alert" className={alertClass}>
        {unavailable ? (
          <p className="font-medium">{LOGIN_MESSAGES.technicalProblem}</p>
        ) : isReset ? (
          <>
            <p className="font-medium">
              {expired ? RESET_PASSWORD_MESSAGES.expired : RESET_PASSWORD_MESSAGES.linkInvalid}
            </p>
            {expired ? null : <p className="mt-1">{RESET_PASSWORD_MESSAGES.linkAdvice}</p>}
            <Button asChild variant="outline" className="mt-3 h-10 border-red-300 bg-white">
              <Link href={FORGOT_PASSWORD_PATH}>Nieuwe link aanvragen</Link>
            </Button>
          </>
        ) : expired ? (
          <p className="font-medium">{SET_PASSWORD_MESSAGES.inviteExpired}</p>
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
