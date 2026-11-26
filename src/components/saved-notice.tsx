"use client";

import { useEffect } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * "Taak #1043 bewaard." after a save. `createTask` and `updateTask` redirect with `?saved=1`;
 * once the message is shown the parameter is removed from the address, so that a reload or a
 * bookmark does not show the message again. The message itself stays on the page. `param` is
 * the name of that parameter: other actions use their own (`?invoiced=marked`). The page reads
 * the parameter on the server and only renders this component when it is valid; the effect also
 * runs again when the message changes, for a component that stays mounted between two actions.
 */
export function SavedNotice({
  children,
  param = "saved",
}: {
  children: string;
  /** The address parameter that asked for this message; it is removed once shown. */
  param?: string;
}) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
  }, [param, children]);

  return (
    <Alert
      role="status"
      className="mb-4 border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
