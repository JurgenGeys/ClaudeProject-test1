import type { Metadata } from "next";
import Link from "next/link";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { previousMonth } from "@/lib/export/period";
import { brusselsDayKey } from "@/lib/time/format";
import { parseExportParams, parseExportProblem } from "@/lib/validation/export";

import { ExportForm } from "./export-form";
import { ExportExample } from "./export-example";

export const metadata: Metadata = { title: "Exporteren" };

/**
 * B4: the form for the CSV export for invoicing (BT-16). The file itself comes from the route
 * handler `download/route.ts`. The page also shows what that route found wrong, through
 * `?problem=` (no days chosen, end before start, nothing to export).
 */
export default async function ExportPage({ searchParams }: PageProps<"/tasks/export">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const raw = await searchParams;
  const parsed = parseExportParams(raw);
  const given = parsed.ok ? parsed.params : parsed;
  const fallback = previousMonth(brusselsDayKey(new Date()));
  // Without any day in the address the form starts with the previous month; a day that was
  // given stays, so an error does not wipe the form.
  const noDays = !raw.from && !raw.to;
  const values = {
    from: noDays ? fallback.from : (given.from ?? ""),
    to: noDays ? fallback.to : (given.to ?? ""),
    scope: given.scope,
  };
  // The problem of the address counts only when its facts agree with the parameters.
  const requested = parseExportProblem(raw.problem);
  const problem = parsed.ok ? (requested === "empty" ? "empty" : null) : parsed.problem;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/tasks" className="text-sm underline-offset-4 hover:underline">
        ← Taken
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Exporteren voor de facturatie</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Download de afgewerkte taken van een periode. Het bestand opent in Excel.
      </p>
      <ExportForm
        // Fresh fields when the address changes (after an error, Back button).
        key={`${values.from}|${values.to}|${values.scope}|${problem}`}
        initial={values}
        problem={problem}
      />
      <ExportExample />
    </div>
  );
}
