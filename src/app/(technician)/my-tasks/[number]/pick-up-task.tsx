"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { telHref } from "@/lib/phone";
import { PICK_UP_MESSAGES, TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { myTasksHref } from "@/lib/validation/my-tasks";

import { pickUpTask, type PickUpTaskState } from "../actions";

/** What went wrong in a way that replaces the button: the page shows a message at the top. */
type PageProblem = "not-assigned" | "changed";

type PickUpContext = {
  problem: PageProblem | null;
  setProblem: (problem: PageProblem | null) => void;
};

const Context = createContext<PickUpContext | null>(null);

function usePickUp(): PickUpContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error("PickUpAlert and PickUpBar must be inside PickUpTask");
  }
  return context;
}

/** Id of the "Opgepikt om" notice (set in the page when the task is picked up). */
export const PICKED_UP_NOTICE_ID = "picked-up-notice";
/** Id of the heading of a cancelled task. */
export const CANCELLED_HEADING_ID = "heading-cancelled";

/**
 * Moves the focus to an element that the page renders after the server answered. The new page
 * arrives a moment after the action result, so look for it for a short while (at most about half
 * a second); the button that had the focus is gone by then.
 */
function focusWhenPresent(id: string, attemptsLeft = 30): void {
  const element = document.getElementById(id);
  if (element) {
    element.focus();
  } else if (attemptsLeft > 0) {
    requestAnimationFrame(() => focusWhenPresent(id, attemptsLeft - 1));
  }
}

/**
 * Groups what belongs to "Oppikken" on T2 (design T2): the message at the top
 * (`PickUpAlert`) and the button with its confirmation (`PickUpBar`) share what went wrong,
 * and the page content in between stays a Server Component (`children`).
 */
export function PickUpTask({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState<PageProblem | null>(null);
  return <Context.Provider value={{ problem, setProblem }}>{children}</Context.Provider>;
}

/**
 * The message when the task was moved or changed meanwhile (design T2, chapter 3). The focus
 * goes to it, and it is a `role="alert"`, so it is read out. Buttons are at least 44 px high.
 */
export function PickUpAlert({ officePhone }: { officePhone?: string }) {
  const { problem, setProblem } = usePickUp();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (problem) {
      ref.current?.focus();
    }
  }, [problem]);

  if (!problem) {
    return null;
  }
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="mt-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {problem === "not-assigned" ? (
        <>
          <p className="font-medium">{PICK_UP_MESSAGES.notAssigned}</p>
          {officePhone ? (
            <p className="mt-1">
              {PICK_UP_MESSAGES.callOfficeIfWrong}{" "}
              <a
                href={telHref(officePhone)}
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              >
                {officePhone}
              </a>
              .
            </p>
          ) : null}
          <Button
            asChild
            variant="outline"
            className="mt-3 h-11 border-red-300 bg-white px-4 text-red-900"
          >
            <Link href={myTasksHref("todo")}>{PICK_UP_MESSAGES.backToMyTasks}</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="font-medium">{TASK_ACTION_MESSAGES.changed}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-11 border-red-300 bg-white px-4 text-red-900"
            onClick={() => {
              setProblem(null);
              router.refresh();
            }}
          >
            {TASK_ACTION_MESSAGES.reload}
          </Button>
        </>
      )}
    </div>
  );
}

type BarProps = {
  taskNumber: number;
  /** The `updated_at` the page was opened with; the server refuses when the task changed. */
  version: string;
  customerName: string;
};

/**
 * The big button at the bottom of T2 for a Toegewezen task, with the confirmation of the design:
 * "Taak oppikken? Kantoor ziet dan dat je onderweg bent naar ... Je kan dit niet zelf ongedaan
 * maken." and the buttons "Ja, ik vertrek" and "Annuleren" (no corner cross: both buttons are 48
 * px high). The focus starts on "Annuleren", the safe choice for something that cannot be undone
 * by the technician; Radix keeps the focus inside the dialog, closes it with Escape and returns
 * the focus to "Oppikken". After a refusal the dialog closes and the message is at the top of
 * the page, or the page shows the cancelled task. A technical problem stays in the dialog.
 */
export function PickUpBar({ taskNumber, version, customerName }: BarProps) {
  const { problem, setProblem } = usePickUp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [, formAction, pending] = useActionState<PickUpTaskState, FormData>(
    async (previous, formData) => {
      const result = await pickUpTask(previous, formData);
      if (!result) {
        return result;
      }
      if (result.ok) {
        setOpen(false);
        focusWhenPresent(PICKED_UP_NOTICE_ID);
      } else if (result.kind === "not-assigned" || result.kind === "changed") {
        setOpen(false);
        setProblem(result.kind);
      } else if (result.kind === "cancelled") {
        setOpen(false);
        focusWhenPresent(CANCELLED_HEADING_ID);
      } else {
        setError(result.message);
      }
      return result;
    },
    null,
  );

  if (problem) {
    return null; // The message at the top says what to do; the button would only fail again.
  }

  return (
    <>
      {/* Room for the fixed bar, so the last block can be scrolled clear of it. */}
      <div aria-hidden className="h-28" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (pending) {
                return; // Do not close while the answer is on its way.
              }
              if (next) {
                setError(null);
              }
              setOpen(next);
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" className="h-12 w-full text-base font-semibold">
                {PICK_UP_MESSAGES.button}
              </Button>
            </DialogTrigger>
            <DialogContent
              showCloseButton={false}
              className="sm:max-w-sm"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                cancelRef.current?.focus();
              }}
            >
              <form action={formAction} className="grid gap-4">
                <input type="hidden" name="taskNumber" value={taskNumber} />
                <input type="hidden" name="version" value={version} />
                <DialogHeader>
                  <DialogTitle className="leading-snug">{PICK_UP_MESSAGES.dialogTitle}</DialogTitle>
                  <DialogDescription className="text-slate-700">
                    Kantoor ziet dan dat je onderweg bent naar{" "}
                    <strong className="break-words">{customerName}</strong>. Je kan dit niet zelf
                    ongedaan maken.
                  </DialogDescription>
                </DialogHeader>
                {error ? (
                  <Alert
                    variant="destructive"
                    className="border-red-200 bg-red-50 text-red-900 *:data-[slot=alert-description]:text-red-900"
                  >
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <DialogFooter className="flex-col sm:flex-col">
                  <Button type="submit" disabled={pending} className="h-12 text-base font-semibold">
                    {pending ? PICK_UP_MESSAGES.confirming : PICK_UP_MESSAGES.confirm}
                  </Button>
                  <Button
                    ref={cancelRef}
                    type="button"
                    variant="outline"
                    disabled={pending}
                    className="h-12 text-base"
                    onClick={() => setOpen(false)}
                  >
                    {PICK_UP_MESSAGES.cancel}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <p className="mt-1 text-center text-xs text-slate-600">{PICK_UP_MESSAGES.buttonHint}</p>
        </div>
      </div>
    </>
  );
}
