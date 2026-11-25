/**
 * Limits on task data. Plain constants without imports, so the Zod schemas, the database
 * schema (check constraints) and Client Components can all use them.
 *
 * There are two kinds, and the difference matters:
 *
 * 1. Decided limits (design chapter 3 and 5, and decision K8). The lengths of the notes and of
 *    the cancellation reason are also check constraints in the database. The hour maxima and
 *    the correction reason length are deliberately only in the Zod schemas, so they can
 *    change without a migration.
 * 2. Technical safety limits for text fields without a length in the design. They only refuse
 *    absurd input (a pasted book). They are NOT product rules and are NOT in the database.
 */

// ---- 1. Decided ------------------------------------------------------------

/** Free text of a completion (design T3 and chapter 5). */
export const NOTES_MAX_LENGTH = 2000;

/** Reason of a cancellation (design B3 and chapter 5). */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

/** Worked hours entered by the technician: 16u00 at most (design T3). */
export const MAX_WORKED_MINUTES = 16 * 60;

/**
 * Maximum estimated duration of a task (B2): 8u00, one working day.
 * Decided by Jurgen on 25/11/2026 (K8).
 */
export const MAX_ESTIMATED_MINUTES = 8 * 60;

/**
 * Maximum of the hours the back office enters in "Uren corrigeren" (B3): 16u00, the same as
 * the technician's limit. Decided by Jurgen on 25/11/2026 (K8).
 */
export const MAX_CORRECTED_MINUTES = 16 * 60;

/**
 * Maximum length of the reason of an hours correction (B3): 500 characters, the same as the
 * cancellation reason. Decided by Jurgen on 25/11/2026 (K8).
 */
export const CORRECTION_REASON_MAX_LENGTH = 500;

// ---- 2. Technical safety limits ------------------------------------------------------------

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
