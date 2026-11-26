/** Texts of marking tasks as invoiced (design B1 and B3). Dutch, for end users. */
export const INVOICE_MESSAGES = {
  // The selection in the overview (B1).
  selectAll: "Alles selecteren",
  /** Spoken after "Alles selecteren": the selection is per page of the overview. */
  selectAllScope: " op deze pagina",
  selectTask: (number: number, customerName: string) =>
    `Selecteer taak #${number}, ${customerName}`,
  selectColumn: "Selecteren",
  selectedCount: (count: number) =>
    count === 1 ? "1 taak geselecteerd" : `${count} taken geselecteerd`,
  barButton: "Markeer als gefactureerd",
  dialogTitle: (count: number) =>
    count === 1 ? "1 taak markeren als gefactureerd?" : `${count} taken markeren als gefactureerd?`,
  dialogText: (count: number) =>
    count === 1
      ? "De uren van deze taak kunnen daarna niet meer gewijzigd worden. Vergist? Je kan de markering ongedaan maken op de pagina van de taak."
      : "De uren van deze taken kunnen daarna niet meer gewijzigd worden. Vergist? Je kan de markering per taak ongedaan maken.",
  cancel: "Annuleren",
  confirm: "Markeer als gefactureerd",
  confirming: "Bezig met markeren…",
  marked: (count: number) =>
    count === 1
      ? 'Taak gemarkeerd als gefactureerd. Je vindt de taak terug onder "Gefactureerd".'
      : `${count} taken gemarkeerd als gefactureerd. Je vindt ze terug onder "Gefactureerd".`,
  /** "2 taken waren al gefactureerd." (design chapter 6). */
  alreadyInvoiced: (count: number) =>
    count === 1 ? "1 taak was al gefactureerd." : `${count} taken waren al gefactureerd.`,
  /** Not marked: the task changed after the list was opened (hours corrected, for example). */
  changed: (count: number) =>
    count === 1
      ? "1 taak is intussen gewijzigd en is niet gemarkeerd. Controleer de taak en probeer opnieuw."
      : `${count} taken zijn intussen gewijzigd en zijn niet gemarkeerd. Controleer de taken en probeer opnieuw.`,
  nothingMarked: "Er is niets gemarkeerd.",

  // One task (B3).
  taskButton: "Markeer als gefactureerd",
  taskDialogTitle: "Markeren als gefactureerd?",
  taskDialogText: "De uren van deze taak kunnen daarna niet meer gewijzigd worden.",
  taskMarked: "Taak gemarkeerd als gefactureerd.",
  taskAlreadyInvoiced: "Deze taak is al gefactureerd.",
  unmarkButton: "Markering ongedaan maken",
  unmarkDialogTitle: "Markering ongedaan maken?",
  unmarkDialogText: "De taak staat dan terug op Afgewerkt en de uren kunnen weer gewijzigd worden.",
  unmarkConfirm: "Ongedaan maken",
  unmarkConfirming: "Bezig met ongedaan maken…",
  unmarked: "Markering ongedaan gemaakt. De taak staat weer op Afgewerkt.",
  /** The invoiced hours are locked (the block "Afmelding" of a Gefactureerd task). */
  lockedHours: "gefactureerde uren · vergrendeld",
  lockedHoursHint:
    "De uren van een gefactureerde taak kunnen niet gewijzigd worden. Maak eerst de markering ongedaan als dat toch nodig is.",
} as const;
