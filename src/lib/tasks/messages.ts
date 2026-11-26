/** Messages of creating a task (design B2). Dutch, for end users. */
export const TASK_ACTION_MESSAGES = {
  /** "Taak #1051 bewaard." (design B2, "Taaknummer"). */
  saved: (number: number) => `Taak #${number} bewaard.`,
  /** The task form as a whole was refused; the fields hold the details. */
  notSaved: "De taak is niet bewaard.",
  customerNotFound: "Deze klant bestaat niet (meer). Kies een andere klant of maak een nieuwe aan.",
  /** The chosen technician was switched off in the meantime (design B2). */
  assigneeInactive: (name: string) => `${name} is niet meer actief. Kies een andere technieker.`,
  /** An invited technician cannot sign in yet, so a task would never reach him. */
  assigneeInvited: (name: string) =>
    `${name} heeft de uitnodiging nog niet aanvaard. Kies een andere technieker.`,
  /** Somebody else changed the task after the form was opened (design chapter 3). */
  changed: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
  reload: "Pagina herladen",
  taskNotFound: "Deze taak bestaat niet (meer).",
  /** Afgewerkt, Gefactureerd or Geannuleerd (`status` in lower case: "afgewerkt"). */
  notEditable: (status: string) => `Deze taak is ${status} en kan niet meer bewerkt worden.`,
  /** The select of a picked up task is disabled; this is for a form that was forged. */
  assigneeLocked:
    "Deze taak is opgepikt. Gebruik 'Terugzetten' om een andere technieker te kiezen.",
  searchFailed: "Zoeken is niet gelukt. Probeer opnieuw.",
  noCustomerFound: (term: string) => `Geen klant gevonden voor '${term}'.`,
} as const;
