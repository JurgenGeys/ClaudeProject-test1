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

/** Messages of picking up a task (design T2, "Foutmeldingen" and chapter 3). Dutch, for end users. */
export const PICK_UP_MESSAGES = {
  /** The task was moved back, given to a colleague or set to "Nog niet toewijzen" meanwhile. */
  notAssigned: "Deze taak is niet meer aan jou toegewezen.",
  /** Followed by ":" and the phone number of the office as a link when it is set, else by ".". */
  callOfficeIfWrong: "Bel kantoor als dit niet klopt",
  backToMyTasks: "Terug naar mijn taken",
  /** The task page itself says it when the task was cancelled; this is for the action result. */
  cancelled: "Deze taak is geannuleerd door kantoor. Je hoeft niets meer te doen.",
  button: "Oppikken",
  buttonHint: "Tik hierop als je vertrekt naar de klant.",
  dialogTitle: "Taak oppikken?",
  confirm: "Ja, ik vertrek",
  confirming: "Bezig met oppikken…",
  cancel: "Annuleren",
} as const;

/** Texts of finishing a task (design T1, T2 and T3). Dutch, for end users. */
export const COMPLETE_MESSAGES = {
  /** The button at the bottom of T2 (a link to T3) and its hint. */
  button: "Afmelden",
  buttonHint: "Tik hierop als het werk klaar is.",
  /** Added to the "Opgepikt om" notice of T2. */
  pickedUpNoticeHint: "Meld af als je klaar bent.",
  /** On the card "Bezig" of T1, after "Opgepikt om 07:48 · ". */
  cardHint: "tik om af te melden",
  heading: "Taak afmelden",
  backToTask: "← Terug naar de taak",
  hoursLegend: "Gewerkte uren",
  hoursHelp: "Enkel de tijd bij de klant. De verplaatsing telt niet mee.",
  lessLabel: "Kwartier minder",
  moreLabel: "Kwartier meer",
  perQuarter: "Per kwartier",
  quickGroup: "Snelkeuze",
  notesLabel: "Notities",
  notesOptional: "(niet verplicht)",
  notesPlaceholder: "Bv. filter vervangen, toestel lekt licht aan binnenunit",
  notesHint: "Kantoor leest dit bij het factureren.",
  summaryHours: "Vul de gewerkte uren in om af te melden.",
  submit: "Taak afmelden",
  submitting: "Bezig met afmelden…",
  cancel: "Annuleren",
  /** Shown on T1 after finishing (`/my-tasks?completed=1`). */
  done: "Taak afgemeld. Bedankt!",
} as const;

/** Texts of putting a task back to Toegewezen (design B3, dialog "Terugzetten"). Dutch, for end users. */
export const RESET_MESSAGES = {
  button: "Terugzetten",
  dialogTitle: "Taak terugzetten",
  /** Followed by the bold word "Toegewezen" and the rest. */
  dialogIntro:
    "Gebruik dit als de taak niet kon doorgaan, bv. omdat de klant niet thuis was. De taak komt terug op",
  dialogOutro: "Je kan meteen een andere technieker of datum kiezen.",
  technician: "Technieker",
  chooseTechnician: "Kies een technieker",
  date: "Datum",
  startTime: "Startuur",
  confirm: "Terugzetten",
  confirming: "Bezig met terugzetten…",
  cancel: "Annuleren",
  /** "Taak teruggezet. Ze staat opnieuw op Toegewezen bij Kevin Wouters, voor di 24/11 om 08:00." */
  done: (technician: string, moment: string) =>
    `Taak teruggezet. Ze staat opnieuw op Toegewezen bij ${technician}, voor ${moment}.`,
} as const;

/** Texts of correcting the hours of an Afgewerkt task (design B3, dialog "Uren corrigeren"). Dutch, for end users. */
export const CORRECT_HOURS_MESSAGES = {
  button: "Uren corrigeren",
  dialogTitle: "Uren corrigeren",
  /** "Ingevuld door Kevin Wouters: <strong>2u00</strong>. De oorspronkelijke uren blijven zichtbaar." */
  filledInBy: (name: string) => `Ingevuld door ${name}:`,
  originalStaysVisible: "De oorspronkelijke uren blijven zichtbaar.",
  newHours: "Nieuwe uren",
  newHoursHint: "Per kwartier, zonder verplaatsing.",
  reason: "Reden",
  reasonPlaceholder: "Bv. pauze niet afgetrokken",
  confirm: "Correctie bewaren",
  confirming: "Bezig met bewaren…",
  cancel: "Annuleren",
  /** The task became Gefactureerd while the dialog was open (design B3). */
  invoiced:
    "Deze taak is al gefactureerd. Maak eerst de markering ongedaan als je de uren wilt wijzigen.",
  /** "Uren gecorrigeerd naar 1u30." after saving. */
  done: (hours: string) => `Uren gecorrigeerd naar ${hours}.`,
} as const;
