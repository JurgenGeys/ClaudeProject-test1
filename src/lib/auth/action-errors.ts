import { LOGIN_MESSAGES, SET_PASSWORD_MESSAGES } from "./messages";
import type { AuthError } from "./session";

/**
 * What a Server Action says when `requireRole` refuses the caller (design chapter 6: "turn it
 * into a `{ ok: false, formError }` result"). The messages only describe the caller's own
 * situation; they never say anything about other users or data.
 */
export function authFailureMessage(error: AuthError): string {
  switch (error.code) {
    case "unavailable":
      return LOGIN_MESSAGES.technicalProblem;
    case "forbidden":
      return "Je hebt geen toegang om dit te doen.";
    case "inactive":
      return LOGIN_MESSAGES.accountDisabled;
    case "invite-expired":
      return SET_PASSWORD_MESSAGES.inviteExpired;
    case "unauthenticated":
    case "password-pending":
      return "Je bent niet (meer) aangemeld. Meld je opnieuw aan.";
  }
}
