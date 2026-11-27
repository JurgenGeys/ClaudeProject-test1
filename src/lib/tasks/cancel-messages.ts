/** Texts of cancelling a task (design B3, dialog "Taak annuleren"). Dutch, for end users. */
export const CANCEL_MESSAGES = {
  button: "Taak annuleren",
  /** "Taak #1043 annuleren?" */
  dialogTitle: (number: string) => `Taak ${number} annuleren?`,
  /** Followed by "en uit de lijst van <technician>" when the task has one, then `dialogIntroEnd`. */
  dialogIntroStart:
    "Gebruik dit als de afspraak niet meer doorgaat, bv. omdat de klant afzegt. De taak verdwijnt uit de planning",
  dialogIntroTechnician: "en uit de lijst van",
  dialogIntroEnd: 'Ze blijft bewaard onder "Geannuleerd".',
  dialogWarning:
    "Annuleren kan je niet ongedaan maken. Moet het werk toch gebeuren, maak dan een nieuwe taak aan.",
  reason: "Reden",
  reasonOptional: "(niet verplicht)",
  reasonPlaceholder: "Bv. klant heeft zelf afgezegd",
  keep: "Taak behouden",
  confirm: "Taak annuleren",
  confirming: "Bezig met annuleren…",
  /** "Taak #1043 is geannuleerd." */
  done: (number: string) => `Taak ${number} is geannuleerd.`,
  /** The technician picked the task up meanwhile: he is on his way (design B3). */
  pickedUp: (technician: string) =>
    `${technician} heeft deze taak intussen opgepikt. Bel hem eerst; zet de taak daarna terug als ze echt niet doorgaat.`,
  /** Fallback when the name is not known (not expected: a picked up task has a technician). */
  pickedUpUnknown:
    "De technieker heeft deze taak intussen opgepikt. Bel hem eerst; zet de taak daarna terug als ze echt niet doorgaat.",
} as const;
