import { z } from "zod";

import { dayParam } from "./task-overview";

/**
 * The query parameters of the export (design B4 and chapter 6):
 *
 *   /tasks/export/download?from=2026-11-01&to=2026-11-30&scope=completed
 *
 * `from` and `to` are days (inclusive) on which the technician completed the task. `scope` is
 * "completed" (only still to invoice, the default) or "all" (also invoiced). Everything is
 * validated here, on the server, also when the form checked it already.
 */
export const exportScopes = ["completed", "all"] as const;
export type ExportScope = (typeof exportScopes)[number];
export const DEFAULT_EXPORT_SCOPE: ExportScope = "completed";

/** What is wrong with the request: used as `?problem=` on the export page. */
export const exportProblems = ["missing", "reversed", "scope", "empty"] as const;
export type ExportProblem = (typeof exportProblems)[number];

export type ExportParams = { from: string; to: string; scope: ExportScope };

export type ExportParamsResult =
  | { ok: true; params: ExportParams }
  | {
      ok: false;
      problem: Exclude<ExportProblem, "empty">;
      /** The valid values that were given, to fill the form again. */
      from: string | null;
      to: string | null;
      scope: ExportScope;
    };

type RawParams = Record<string, string | string[] | undefined>;

function day(raw: RawParams, key: "from" | "to"): string | null {
  const value = raw[key];
  const parsed = typeof value === "string" ? dayParam.safeParse(value) : null;
  return parsed?.success ? parsed.data : null;
}

/** Reads and checks the parameters. Never throws. A missing `scope` is the default; a wrong one is a problem. */
export function parseExportParams(raw: RawParams): ExportParamsResult {
  const from = day(raw, "from");
  const to = day(raw, "to");
  const scopeRaw = raw.scope;
  const scope =
    scopeRaw === undefined
      ? { success: true as const, data: DEFAULT_EXPORT_SCOPE }
      : z.enum(exportScopes).safeParse(scopeRaw);
  const validScope = scope.success ? scope.data : DEFAULT_EXPORT_SCOPE;

  if (!from || !to) {
    return { ok: false, problem: "missing", from, to, scope: validScope };
  }
  // The same day is fine (a one-day export); only an end before the start is wrong.
  if (to < from) {
    return { ok: false, problem: "reversed", from, to, scope: validScope };
  }
  if (!scope.success) {
    return { ok: false, problem: "scope", from, to, scope: validScope };
  }
  return { ok: true, params: { from, to, scope: scope.data } };
}

/** `?problem=` of the export page: only the known values, anything else is ignored. */
export function parseExportProblem(value: string | string[] | undefined): ExportProblem | null {
  const parsed = z.enum(exportProblems).safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The address of the export page for the form values and a problem. Only validated values go in. */
export function exportPageHref(values: {
  from: string | null;
  to: string | null;
  scope: ExportScope;
  problem: ExportProblem;
}): string {
  const query = new URLSearchParams();
  if (values.from) query.set("from", values.from);
  if (values.to) query.set("to", values.to);
  query.set("scope", values.scope);
  query.set("problem", values.problem);
  return `/tasks/export?${query.toString()}`;
}
