import { describe, expect, it } from "vitest";

import {
  buildCsv,
  CSV_BOM,
  csvRow,
  csvTextCell,
  EXPORT_COLUMNS,
  exportFilename,
  formatExportDate,
  neutralizeFormula,
  type ExportRow,
} from "./csv";

const row: ExportRow = {
  number: 1042,
  completedDay: "2026-10-02",
  customerName: "Fam. Hermans",
  street: "Kerkstraat 9",
  postalCode: "2350",
  city: "Vosselaar",
  technicianName: "Bram Claes",
  workType: "inspection",
  instructions: "Nazicht buitenunit",
  minutes: 75,
  notes: "Alles in orde",
  status: "completed",
};

describe("neutralizeFormula", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("puts a quote before %j", (value) => {
    expect(neutralizeFormula(value)).toBe(`'${value}`);
  });

  it.each(["gewoon", "a=b", " =x", "1,5", ""])("leaves %j alone", (value) => {
    expect(neutralizeFormula(value)).toBe(value);
  });
});

describe("csvTextCell", () => {
  it("quotes a cell with the separator, doubles quotes, and keeps line breaks inside quotes", () => {
    expect(csvTextCell("a;b")).toBe('"a;b"');
    expect(csvTextCell('zei "ja"')).toBe('"zei ""ja"""');
    expect(csvTextCell("regel 1\r\nregel 2")).toBe('"regel 1\r\nregel 2"');
    expect(csvTextCell("regel 1\nregel 2")).toBe('"regel 1\nregel 2"');
  });

  it("does not quote plain text and keeps accents and commas", () => {
    expect(csvTextCell("Kerkstraat 9, 2350 Vosselaar")).toBe("Kerkstraat 9, 2350 Vosselaar");
    expect(csvTextCell("Café Zoë")).toBe("Café Zoë");
  });

  it("neutralizes first and then quotes, so a formula with the separator stays text", () => {
    expect(csvTextCell('=HYPERLINK("x";"y")')).toBe('"\'=HYPERLINK(""x"";""y"")"');
  });
});

describe("formatExportDate", () => {
  it("writes day, month, year", () => {
    expect(formatExportDate("2026-10-02")).toBe("02/10/2026");
  });
  it("refuses anything else", () => {
    expect(() => formatExportDate("2/10/2026")).toThrow(RangeError);
    expect(() => formatExportDate("2026-10-02T10:00")).toThrow(RangeError);
  });
});

describe("csvRow", () => {
  it("writes the columns in order, with a plain task number and a decimal comma", () => {
    expect(csvRow(row)).toBe(
      "1042;02/10/2026;Fam. Hermans;Kerkstraat 9, 2350 Vosselaar;Bram Claes;Nazicht;Nazicht buitenunit;1,25;Alles in orde;Afgewerkt",
    );
  });

  it.each([
    [15, "0,25"],
    [60, "1"],
    [90, "1,5"],
    [150, "2,5"],
    [945, "15,75"],
  ])("writes %i minutes as %s hours (no rounding)", (minutes, text) => {
    expect(csvRow({ ...row, minutes }).split(";")[7]).toBe(text);
  });

  it("uses the Dutch labels for work type and status", () => {
    const cells = csvRow({ ...row, workType: "repair", status: "invoiced" }).split(";");
    expect(cells[5]).toBe("Herstelling");
    expect(cells[9]).toBe("Gefactureerd");
    expect(csvRow({ ...row, workType: "maintenance" }).split(";")[5]).toBe("Onderhoud");
  });

  it("leaves technician and notes empty when there are none", () => {
    expect(csvRow({ ...row, technicianName: null, notes: null })).toBe(
      "1042;02/10/2026;Fam. Hermans;Kerkstraat 9, 2350 Vosselaar;;Nazicht;Nazicht buitenunit;1,25;;Afgewerkt",
    );
  });

  it("neutralizes every text column that a user typed", () => {
    const line = csvRow({
      ...row,
      customerName: "=cmd",
      street: "@x",
      technicianName: "+1",
      instructions: "-2",
      notes: "- filter vervangen",
    });
    expect(line).toBe(
      "1042;02/10/2026;'=cmd;'@x, 2350 Vosselaar;'+1;Nazicht;'-2;1,25;'- filter vervangen;Afgewerkt",
    );
  });

  it("keeps a multi-line instruction in one cell", () => {
    const line = csvRow({ ...row, instructions: "Regel 1\nRegel 2; met puntkomma" });
    expect(line).toContain('"Regel 1\nRegel 2; met puntkomma"');
  });
});

describe("buildCsv", () => {
  const file = buildCsv([row, { ...row, number: 1043 }]);

  it("starts with the byte order mark and the headers", () => {
    expect(file.startsWith(CSV_BOM)).toBe(true);
    expect(file.slice(1).split("\r\n")[0]).toBe(EXPORT_COLUMNS.join(";"));
    expect(EXPORT_COLUMNS).toEqual([
      "Taaknummer",
      "Datum",
      "Klant",
      "Adres",
      "Technieker",
      "Soort werk",
      "Omschrijving",
      "Gewerkte uren",
      "Notities",
      "Status",
    ]);
  });

  it("has one line per task and ends with a line break", () => {
    const lines = file.slice(1).split("\r\n");
    expect(lines).toHaveLength(4); // header, two tasks, empty after the last break
    expect(lines[3]).toBe("");
    expect(lines[1].startsWith("1042;")).toBe(true);
    expect(lines[2].startsWith("1043;")).toBe(true);
  });

  it("encodes as UTF-8 with the three BOM bytes", () => {
    const bytes = new TextEncoder().encode(buildCsv([{ ...row, customerName: "Café" }]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toContain("Café");
  });
});

describe("exportFilename", () => {
  it("is built from the two days", () => {
    expect(exportFilename("2026-11-01", "2026-11-30")).toBe("taken-2026-11-01-tot-2026-11-30.csv");
  });
  it("refuses anything that is not a plain day (no quotes, slashes or line breaks in a name)", () => {
    expect(() => exportFilename('2026-11-01"; x', "2026-11-30")).toThrow(RangeError);
    expect(() => exportFilename("2026-11-01", "../2026-11-30")).toThrow(RangeError);
    expect(() => exportFilename("2026-11-01", "2026-11-30\r\n")).toThrow(RangeError);
  });
});
