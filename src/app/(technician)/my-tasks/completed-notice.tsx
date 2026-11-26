"use client";

import { useEffect } from "react";

import { COMPLETE_MESSAGES } from "@/lib/tasks/messages";

/**
 * "Taak afgemeld. Bedankt!" on Mijn taken after finishing a task. `completeTask` redirects with
 * `?completed=1`; once the message is shown the parameter is removed from the address, so a
 * reload or a bookmark does not show it again. The message itself stays on the page.
 */
export function CompletedNotice() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("completed")) {
      url.searchParams.delete("completed");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
  }, []);

  return (
    <div
      role="status"
      className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900"
    >
      {COMPLETE_MESSAGES.done}
    </div>
  );
}
