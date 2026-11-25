/**
 * Limits on task data. Plain constants without imports, so the Zod schemas, the database
 * schema (check constraints) and Client Components can all use them.
 *
 * There are two kinds, and the difference matters:
 *
 * 1. Limits from the design (chapter 3 and 5). Decided, so they are also enforced by a check
 *    constraint in the database.
 * 2. Technical safety limits. Nobody decided these: they only refuse absurd input (a pasted
 *    book, a duration of ten years). They are NOT product rules and are NOT in the database.
 *    Jurgen still has to decide the first three (the TODO constants).
 */

// ---- 1. Decided in the design ------------------------------------------------------------

/** Free text of a completion (design T3 and chapter 5). */
export const NOTES_MAX_LENGTH = 2000;

/** Reason of a cancellation (design B3 and chapter 5). */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

/** Worked hours entered by the technician: 16u00 at most (design T3). */
export const MAX_WORKED_MINUTES = 16 * 60;

// ---- 2. Not decided yet: technical safety limits only ------------------------------------

/**
 * TODO: nog te beslissen door Jurgen.
 * Maximum estimated duration of a task (B2). The design only says "per quarter of an hour".
 * Until Jurgen decides, 7 days only refuses absurd values.
 */
export const MAX_ESTIMATED_MINUTES = 7 * 24 * 60;

/**
 * TODO: nog te beslissen door Jurgen.
 * Maximum of the hours the back office enters in "Uren corrigeren" (B3). The design does not
 * say whether this is 16u00 like the technician's limit. Until Jurgen decides, 7 days only
 * refuses absurd values.
 */
export const MAX_CORRECTED_MINUTES = 7 * 24 * 60;

/**
 * TODO: nog te beslissen door Jurgen.
 * Maximum length of the reason of an hours correction (B3). The design only makes it required.
 */
export const CORRECTION_REASON_MAX_LENGTH = 1000;

/**
 * Technical safety limits for the other text fields. The design gives no lengths for these;
 * they are far above anything a person types and exist so a request cannot store megabytes.
 */
export const TEXT_LIMITS = {
  /** Names of a customer. */
  name: 200,
  /** Street and number, city, phone, e-mail (320 is the longest valid address). */
  street: 200,
  city: 100,
  phone: 50,
  email: 320,
  /** Customer remarks and task instructions. */
  longText: 5000,
} as const;
