/** Messages on the login screen (design G1). Shown to end users, so in Dutch. */
export const LOGIN_MESSAGES = {
  emailRequired: "Vul je e-mailadres in.",
  passwordRequired: "Vul je wachtwoord in.",
  // Never says which of the two is wrong, so the screen does not reveal which addresses exist.
  invalidCredentials: "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.",
  // Only for someone who was already signed in when the account was disabled (`/auth/inactive`).
  // Signing in itself never says this: that would reveal the account exists.
  accountDisabled: "Je account is uitgeschakeld. Neem contact op met kantoor.",
  tooManyAttempts: "Te veel pogingen, probeer het over enkele minuten opnieuw.",
  emailTooLong: "Dit e-mailadres is te lang.",
  passwordTooLong: "Dit wachtwoord is te lang.",
  technicalProblem: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
} as const;

/** Messages of "Wachtwoord instellen" (design G2). Shown to end users, so in Dutch. */
export const SET_PASSWORD_MESSAGES = {
  // An invitation that is expired, already used or otherwise invalid (design G2).
  inviteLinkInvalid: "Deze link is niet meer geldig.",
  inviteLinkAdvice: "Vraag kantoor om een nieuwe uitnodiging.",
  // The temporary session after the link was used is older than 24 hours.
  inviteExpired: "De link is verlopen. Vraag kantoor om een nieuwe uitnodiging.",
} as const;
