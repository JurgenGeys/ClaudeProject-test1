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
  // Switching off (BT-07). `deactivated` and `hasOpenTasks` follow the texts of design B7.
  deactivated: (name: string) =>
    `${name} is uitgeschakeld. Zijn afgewerkte taken en uren blijven bewaard.`,
  hasOpenTasks: (name: string, count: number) =>
    `${name} heeft nog taken die niet afgewerkt zijn (${count}). Wijs die eerst aan een andere technieker toe.`,
  cannotDeactivate: "Uitschakelen kan nog niet.",
  alreadyDisabled: (name: string) => `${name} is al uitgeschakeld. Laad de pagina opnieuw.`,
  notAccepted: (name: string) =>
    `${name} heeft de uitnodiging nog niet aanvaard en kan daarom niet uitgeschakeld worden.`,
  // Switching on again (BT-07b). `reactivated` follows the text of design B7.
  reactivated: (name: string) => `${name} is opnieuw actief. Je kan hem weer taken toewijzen.`,
  alreadyActive: (name: string) => `${name} is al actief. Laad de pagina opnieuw.`,
  notDisabled: (name: string) =>
    `${name} heeft de uitnodiging nog niet aanvaard en is niet uitgeschakeld.`,
  // Revoking an invitation (BT-07c).
  revoked: (name: string) =>
    `De uitnodiging van ${name} is ingetrokken. De link in de mail werkt niet meer.`,
  notPending: (name: string) =>
    `${name} heeft al een wachtwoord gekozen en kan niet meer ingetrokken worden. Laad de pagina opnieuw.`,
  hasRecords: (name: string) =>
    `De uitnodiging van ${name} kan niet ingetrokken worden: er hangen nog gegevens aan.`,
} as const;
