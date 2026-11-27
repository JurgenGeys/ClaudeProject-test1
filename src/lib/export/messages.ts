import { formatExportDate } from "./csv";

/** Texts of the export (design B4). Dutch, for end users. */
export const EXPORT_MESSAGES = {
  title: "Exporteren voor de facturatie",
  intro: "Download de afgewerkte taken van een periode. Het bestand opent in Excel.",
  button: "Exporteren",
  back: "← Taken",
  period: "Periode",
  periodHint: "Op de datum waarop de technieker de taak afmeldde. Maximaal 1 jaar.",
  from: "Van",
  to: "Tot en met",
  scope: "Welke taken",
  scopeCompleted: "Enkel nog te factureren",
  scopeCompletedHint: "Taken met status Afgewerkt",
  scopeAll: "Afgewerkt en gefactureerd",
  scopeAllHint: "Bv. om een overzicht voor de boekhouder te maken",
  download: "Download",
  downloading: "Bezig met downloaden…",
  missing: "Kies een begin- en einddatum.",
  // The same text as the period filter of the overview (B1).
  reversed: "De einddatum ligt vóór de begindatum.",
  tooLong: "De periode is te lang. Kies hoogstens 1 jaar (366 dagen).",
  scopeProblem: "Kies welke taken je wilt exporteren.",
  empty: (from: string, to: string) =>
    `Er zijn geen afgewerkte taken tussen ${formatExportDate(from)} en ${formatExportDate(to)}. Er is niets te exporteren.`,
  emptyAdvice: "Kies een andere periode.",
  failed: "Het bestand kon niet worden gemaakt. Probeer het opnieuw.",
  downloaded: (count: number, filename: string) =>
    `Het bestand met ${count === 1 ? "1 taak" : `${count} taken`} is gedownload (${filename}). Markeer de taken als gefactureerd zodra je ze gefactureerd hebt.`,
  toCompleted: "Naar de afgewerkte taken",
  exampleTitle: "Zo ziet het bestand eruit",
  exampleNote:
    "Uren als getal (1u30 = 1,5), zodat je ermee kan rekenen. Gecorrigeerde uren vervangen de uren van de technieker. Geannuleerde taken staan nooit in het bestand. Tekst die met =, +, - of @ begint, krijgt een apostrof ervoor (bv. '- filter vervangen), zodat Excel er geen formule van maakt.",
  dateNote: "De datum in het bestand is de dag waarop de technieker de taak afmeldde.",
} as const;
