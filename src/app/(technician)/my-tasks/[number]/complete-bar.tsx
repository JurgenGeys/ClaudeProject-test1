import Link from "next/link";

import { COMPLETE_MESSAGES } from "@/lib/tasks/messages";

/**
 * The big button at the bottom of T2 for an Opgepikt task (design T2): a plain link to T3 (it
 * only navigates), styled as a button of 48 px, fixed at the bottom, with its hint.
 */
export function CompleteBar({ taskNumber }: { taskNumber: number }) {
  return (
    <>
      {/* Room for the fixed bar, so the last block can be scrolled clear of it. */}
      <div aria-hidden className="h-28" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <Link
            href={`/my-tasks/${taskNumber}/complete`}
            className="flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {COMPLETE_MESSAGES.button}
          </Link>
          <p className="mt-1 text-center text-xs text-slate-600">{COMPLETE_MESSAGES.buttonHint}</p>
        </div>
      </div>
    </>
  );
}
