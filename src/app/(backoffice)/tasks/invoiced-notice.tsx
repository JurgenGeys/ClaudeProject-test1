"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { INVOICE_MESSAGES } from "@/lib/tasks/invoice-messages";

/**
 * "Taak gemarkeerd als gefactureerd." or "Markering ongedaan gemaakt." on B3 after the action
 * redirected with `?invoiced=marked` or `?invoiced=unmarked` (only these two values count). The
 * message is kept in state when the parameter arrives, and the parameter is removed from the address, so
 * a reload or a bookmark does not show it again.
 */
export function InvoicedNotice() {
  const param = useSearchParams()?.get("invoiced");
  const [kind, setKind] = useState<"marked" | "unmarked" | null>(null);
  // Marking and unmarking redirect to this same page, so the component stays mounted: take over
  // a new value while rendering. The parameter is gone after the effect below, the message stays.
  const incoming = param === "marked" || param === "unmarked" ? param : null;
  if (incoming && incoming !== kind) {
    setKind(incoming);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("invoiced")) {
      url.searchParams.delete("invoiced");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
  }, []);

  if (!kind) {
    return null;
  }
  return (
    <Alert
      role="status"
      className="mb-4 border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
    >
      <AlertDescription>
        {kind === "marked" ? INVOICE_MESSAGES.taskMarked : INVOICE_MESSAGES.unmarked}
      </AlertDescription>
    </Alert>
  );
}
