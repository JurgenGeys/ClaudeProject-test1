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

/** Messages of "Wachtwoord vergeten" (design G3) and of G2 in mode reset. Dutch, for end users. */
export const FORGOT_PASSWORD_MESSAGES = {
  emailRequired: "Vul je e-mailadres in.",
  emailInvalid: "Vul een geldig e-mailadres in.",
  // The same text for every address that was entered, known or not, active or not, and also
  // when Supabase refuses to send another mail (rate limit): the screen must not tell which
  // addresses exist (decision Jurgen, 24/11/2026).
  sent: "Als dit e-mailadres bij ons gekend is, krijg je binnen enkele minuten een mail met een link om een nieuw wachtwoord te kiezen.",
} as const;

export const RESET_PASSWORD_MESSAGES = {
  // Mode reset of G2: link used, expired or otherwise invalid.
  linkInvalid: "Deze link is niet meer geldig.",
  linkAdvice: "Vraag een nieuwe link aan.",
  // The temporary session after the click is older than 24 hours.
  expired: "De link is verlopen. Vraag een nieuwe link aan.",
} as const;
