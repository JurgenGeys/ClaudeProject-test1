import { EXPORT_COLUMNS } from "@/lib/export/csv";
import { EXPORT_MESSAGES } from "@/lib/export/messages";

/** Invented example lines, only to show the columns (design B4: "Zo ziet het bestand eruit"). */
const EXAMPLE_ROWS = [
  [
    "1001",
    "02/10/2026",
    "Fam. Hermans",
    "Kerkstraat 9, 2350 Vosselaar",
    "Bram Claes",
    "Nazicht",
    "Nazicht buitenunit",
    "1,25",
    "Alles in orde",
    "Afgewerkt",
  ],
  [
    "1002",
    "05/10/2026",
    "Garage Smets",
    "Lindendreef 2, 2275 Lille",
    "Jens Maes",
    "Onderhoud",
    "Onderhoud showroom",
    "2,5",
    "Filter vervangen",
    "Afgewerkt",
  ],
];

export function ExportExample() {
  return (
    <section aria-labelledby="export-example" className="mt-10">
      <h2 id="export-example" className="text-lg font-semibold">
        {EXPORT_MESSAGES.exampleTitle}
      </h2>
      {/* Tabindex: a scrollable region must be reachable with the keyboard. */}
      <div
        className="mt-3 overflow-x-auto rounded-md border"
        tabIndex={0}
        role="region"
        aria-label="Voorbeeld"
      >
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Voorbeeld met twee verzonnen taken</caption>
          <thead className="bg-muted/50">
            <tr>
              {EXPORT_COLUMNS.map((column) => (
                <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_ROWS.map((row) => (
              <tr key={row[0]} className="border-t">
                {row.map((cell, index) => (
                  <td key={EXPORT_COLUMNS[index]} className="whitespace-nowrap px-3 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{EXPORT_MESSAGES.dateNote}</p>
      <p className="mt-1 text-sm text-muted-foreground">{EXPORT_MESSAGES.exampleNote}</p>
    </section>
  );
}
