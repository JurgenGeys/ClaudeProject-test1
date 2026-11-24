/** Messages on the login screen (design G1). Shown to end users, so in Dutch. */
export const LOGIN_MESSAGES = {
  emailRequired: "Vul je e-mailadres in.",
  passwordRequired: "Vul je wachtwoord in.",
  // Never says which of the two is wrong, so the screen does not reveal which addresses exist.
  invalidCredentials: "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.",
  accountDisabled: "Je account is uitgeschakeld. Neem contact op met kantoor.",
  technicalProblem: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
} as const;
