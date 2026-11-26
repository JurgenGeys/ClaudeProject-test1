/** Messages of the customer screens (design B5 and B6). Dutch, for end users. */
export const CUSTOMER_ACTION_MESSAGES = {
  /** "Klant bewaard." after a save (design B6). */
  saved: "Klant bewaard.",
  /** The summary above the form: "De klant is niet bewaard. Verbeter de 2 gemarkeerde velden." */
  notSaved: (count: number) =>
    `De klant is niet bewaard. ${
      count === 1 ? "Verbeter het gemarkeerde veld." : `Verbeter de ${count} gemarkeerde velden.`
    }`,
  /** The customer was opened for editing, but is not there when saving (a forged or old form). */
  notFound: "Deze klant bestaat niet (meer).",
  /** "Geen klant gevonden voor 'xyz'." (design B5) */
  noneFound: (text: string) => `Geen klant gevonden voor '${text}'.`,
} as const;
