import { formatHours } from "@/lib/time/format";
import {
  CANCELLATION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MAX_LENGTH,
  MAX_CORRECTED_MINUTES,
  MAX_ESTIMATED_MINUTES,
  MAX_WORKED_MINUTES,
  NOTES_MAX_LENGTH,
} from "@/lib/tasks/limits";

/** Error messages of the task, customer and hours forms (design chapter 3). Dutch, for end users. */

export const TASK_MESSAGES = {
  customerRequired: "Kies een klant of maak een nieuwe klant aan.",
  streetRequired: "Vul de straat en het huisnummer in.",
  postalCodeInvalid: "Vul een geldige postcode in (4 cijfers).",
  cityRequired: "Vul de gemeente in.",
  workTypeRequired: "Kies het soort werk: nazicht, onderhoud of herstelling.",
  instructionsRequired: "Beschrijf wat de technieker moet doen.",
  dateRequired: "Kies een datum.",
  startTimeRequired: "Kies een startuur.",
  estimatedMinutesInvalid: "Vul de geschatte duur in per kwartier, bv. 1u30.",
  estimatedMinutesTooLong: `De geschatte duur mag niet meer zijn dan ${formatHours(MAX_ESTIMATED_MINUTES)}.`,
  assigneeInvalid: "Kies een technieker uit de lijst.",
  tooLong: "Deze tekst is te lang. Maak hem korter.",
} as const;

export const CUSTOMER_MESSAGES = {
  nameRequired: "Vul de naam van de klant in.",
  emailInvalid: "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
  postalCodeInvalid: "Vul een geldige postcode in (4 cijfers).",
  tooLong: "Deze tekst is te lang. Maak hem korter.",
} as const;

export const COMPLETION_MESSAGES = {
  minutesRequired: "Vul de gewerkte uren in. Dat moet minstens 0u15 zijn.",
  minutesNotQuarter: "Vul de gewerkte uren in per kwartier, bv. 1u30.",
  minutesTooMany: `De gewerkte uren mogen niet meer zijn dan ${formatHours(MAX_WORKED_MINUTES)}.`,
  notesTooLong: `Je notitie is te lang. Houd het korter dan ${NOTES_MAX_LENGTH} tekens.`,
} as const;

export const CORRECTION_MESSAGES = {
  minutesRequired: "Vul de nieuwe uren in. Dat moet minstens 0u15 zijn.",
  minutesNotQuarter: "Vul de nieuwe uren in per kwartier, bv. 1u30.",
  minutesTooMany: `De nieuwe uren mogen niet meer zijn dan ${formatHours(MAX_CORRECTED_MINUTES)}.`,
  reasonRequired: "Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'.",
  reasonTooLong: `De reden is te lang. Houd ze korter dan ${CORRECTION_REASON_MAX_LENGTH} tekens.`,
} as const;

export const CANCELLATION_MESSAGES = {
  reasonTooLong: `De reden is te lang. Houd ze korter dan ${CANCELLATION_REASON_MAX_LENGTH} tekens.`,
} as const;

/** Error messages of the "Technieker toevoegen" dialog (design B7). */
export const TECHNICIAN_MESSAGES = {
  nameRequired: "Vul de naam in.",
  emailInvalid: "Vul een geldig e-mailadres in.",
  emailExists: "Er bestaat al een gebruiker met dit e-mailadres.",
  tooLong: "Deze tekst is te lang. Maak hem korter.",
} as const;

/** Messages of "Wachtwoord instellen" (design G2). */
export const PASSWORD_MESSAGES = {
  tooShort: "Je wachtwoord moet minstens 8 tekens hebben.",
  // Supabase (bcrypt) refuses passwords of more than 72 bytes. Bytes, not characters, so the
  // message does not give a number.
  tooLong: "Gebruik een korter wachtwoord.",
  mismatch: "De twee wachtwoorden zijn niet gelijk.",
  tooWeak: "Dit wachtwoord is te zwak. Kies een ander wachtwoord.",
  // Mode reset only: the new password may not be the old one.
  sameAsOld: "Kies een ander wachtwoord dan je vorige.",
} as const;
