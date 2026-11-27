import type { Metadata } from "next";
import Link from "next/link";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { EXPORT_MESSAGES } from "@/lib/export/messages";
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
  // A first visit has no days and no problem in the address: it starts with the previous month
  // and shows no complaint. Once days or `?problem=` are there (after a submit), what was given
  // stays as it is, also when a day is missing, and the problem is shown.
  const firstVisit = raw.from === undefined && raw.to === undefined && raw.problem === undefined;
  const values = {
    from: firstVisit ? fallback.from : (given.from ?? ""),
    to: firstVisit ? fallback.to : (given.to ?? ""),
    scope: given.scope,
  };
  // `?problem=empty` counts only when the parameters are valid; the other problems are found again here.
  const requested = parseExportProblem(raw.problem);
  const problem = firstVisit
    ? null
    : parsed.ok
      ? requested === "empty"
        ? "empty"
        : null
      : parsed.problem;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/tasks" className="text-sm underline-offset-4 hover:underline">
        {EXPORT_MESSAGES.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{EXPORT_MESSAGES.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{EXPORT_MESSAGES.intro}</p>
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
