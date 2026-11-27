import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { AuthError, requireRole } from "@/lib/auth/session";
import { buildCsv, exportFilename } from "@/lib/export/csv";
import { queryExportRows } from "@/lib/export/query";
import { exportPageHref, parseExportParams } from "@/lib/validation/export";
import { EXPORT_MESSAGES } from "@/lib/export/messages";

/** Only the kind of error: the message of a database error can hold data. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** One value of a query parameter, or the list when it was given more than once (which is invalid). */
function param(url: URL, key: string): string | string[] | undefined {
  const values = url.searchParams.getAll(key);
  return values.length === 0 ? undefined : values.length === 1 ? values[0] : values;
}

/**
 * `GET /tasks/export/download?from=…&to=…&scope=completed|all` (design B4, chapter 6): the CSV
 * file for invoicing. Order of the steps:
 * 1. `requireRole("backoffice")` first (ADR-0002, rule 3); no data is read before;
 * 2. Zod validation of the parameters;
 * 3. one read through Drizzle, on the server;
 * 4. an invalid or empty request goes back to the export page (a fixed path, only validated
 *    values in the query: there is no open redirect) with `?problem=`; otherwise the file.
 * The file name is built from validated dates only. Nothing personal is logged.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole("backoffice");
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "forbidden") {
        return text(403, "Deze pagina is niet voor jou bedoeld.");
      }
      if (error.code === "unavailable") {
        return text(503, "De aanmelding is tijdelijk niet beschikbaar. Probeer het later opnieuw.");
      }
      return text(401, "Je bent niet aangemeld.");
    }
    throw error;
  }

  const url = new URL(request.url);
  const parsed = parseExportParams({
    from: param(url, "from"),
    to: param(url, "to"),
    scope: param(url, "scope"),
  });
  if (!parsed.ok) {
    return NextResponse.redirect(new URL(exportPageHref(parsed), request.url), 303);
  }

  let rows;
  try {
    rows = await queryExportRows(getDb(), parsed.params);
  } catch (error) {
    console.error(`Export failed: ${describeError(error)}`);
    return text(500, EXPORT_MESSAGES.failed);
  }

  if (rows.length === 0) {
    return NextResponse.redirect(
      new URL(exportPageHref({ ...parsed.params, problem: "empty" }), request.url),
      303,
    );
  }

  const filename = exportFilename(parsed.params.from, parsed.params.to);
  return new NextResponse(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // For the page, which shows "Het bestand met 12 taken is gedownload".
      "X-Export-Count": String(rows.length),
    },
  });
}
