"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/** What the last "Markeer als gefactureerd" did: a confirmation and/or what was left out. */
export type InvoicingNotice = { success: string | null; problems: string[] } | null;

const SetNoticeContext = createContext<(notice: InvoicingNotice) => void>(() => {});

/** Lets the selection show its result above the list. */
export function useSetInvoicingNotice(): (notice: InvoicingNotice) => void {
  return useContext(SetNoticeContext);
}

/**
 * Holds the result message of marking tasks and shows it above its children (design chapter 3:
 * "Na een geslaagde actie: korte bevestiging bovenaan"). It wraps the whole list area, not just
 * the list, so the message stays when the last task of the page was marked and the list gives
 * way to the empty state. The live region is always in the page, so a screen reader announces
 * a message that appears in it (an empty region takes no room; the margin is on the message). Green when everything went well, amber when something was left out.
 */
export function InvoicingNoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<InvoicingNotice>(null);
  const warning = notice !== null && notice.problems.length > 0;

  return (
    <SetNoticeContext.Provider value={setNotice}>
      <div role="status">
        {notice ? (
          <Alert
            className={
              warning
                ? "mt-4 border-amber-300 bg-amber-50 text-amber-950 *:data-[slot=alert-description]:text-amber-950"
                : "mt-4 border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
            }
          >
            <AlertDescription>
              {notice.success ? <p>{notice.success}</p> : null}
              {notice.problems.map((problem) => (
                <p key={problem}>{problem}</p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      {children}
    </SetNoticeContext.Provider>
  );
}
