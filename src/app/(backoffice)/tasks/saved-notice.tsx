"use client";

import { useEffect } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * "Taak #1043 bewaard." after a save. `createTask` and `updateTask` redirect with `?saved=1`;
 * once the message is shown the parameter is removed from the address, so that a reload or a
 * bookmark does not show the message again. The message itself stays on the page.
 */
export function SavedNotice({ children }: { children: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
  }, []);

  return (
    <Alert
      role="status"
      className="mb-4 border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
