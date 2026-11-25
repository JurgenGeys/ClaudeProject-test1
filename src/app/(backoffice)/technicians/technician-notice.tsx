"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export type TechnicianNotice = { kind: "success" | "error"; message: string } | null;

const SetNoticeContext = createContext<(notice: TechnicianNotice) => void>(() => {});

/** Lets the dialog and the "opnieuw versturen" buttons show their result above the list. */
export function useSetTechnicianNotice(): (notice: TechnicianNotice) => void {
  return useContext(SetNoticeContext);
}

/**
 * Holds the confirmation or error message of B7 and shows it above its children (design
 * chapter 3: "Na een geslaagde actie: korte bevestiging bovenaan"). The live region is always
 * in the page, so a screen reader announces a message that appears in it.
 */
export function TechnicianNoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<TechnicianNotice>(null);

  return (
    <SetNoticeContext.Provider value={setNotice}>
      <div role="status" className="empty:hidden">
        {notice ? (
          <Alert
            // An error is announced at once, a confirmation politely (via the live region).
            role={notice.kind === "error" ? "alert" : undefined}
            variant={notice.kind === "error" ? "destructive" : "default"}
            className={
              notice.kind === "error"
                ? "mb-4 border-red-200 bg-red-50 text-red-900 *:data-[slot=alert-description]:text-red-900"
                : "mb-4 border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
            }
          >
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      {children}
    </SetNoticeContext.Provider>
  );
}
