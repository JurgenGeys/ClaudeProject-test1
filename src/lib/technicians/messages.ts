/** Messages of the technician screen (design B7). Dutch, for end users. */
export const TECHNICIAN_ACTION_MESSAGES = {
  invited: (email: string) =>
    `Uitnodiging verstuurd naar ${email}. De technieker krijgt een mail met een link om een wachtwoord te kiezen.`,
  resent: (email: string) => `Uitnodiging opnieuw verstuurd naar ${email}.`,
  tooManyMails: "Er zijn te veel mails verstuurd. Probeer het over enkele minuten opnieuw.",
  notFound: "Deze technieker bestaat niet (meer). Laad de pagina opnieuw.",
  alreadyAccepted: (name: string) =>
    `${name} heeft al een wachtwoord gekozen. Laad de pagina opnieuw.`,
  disabled: (name: string) => `${name} is uitgeschakeld. Een uitnodiging versturen kan niet.`,
} as const;
