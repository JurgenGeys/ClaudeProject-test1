"use client";

import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { INVOICE_MESSAGES } from "@/lib/tasks/invoice-messages";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import type { TaskStatus } from "@/lib/tasks/types";
import { formatTaskRef, INVOICE_TASK_FIELD } from "@/lib/validation/invoice";

import {
  markInvoiced,
  unmarkInvoiced,
  type MarkInvoicedState,
  type UnmarkInvoicedState,
} from "./invoice-actions";

type Props = {
  number: number;
  /** The `updated_at` the page was opened with; the server refuses when the task changed. */
  version: string;
  status: TaskStatus;
};

type Problem = { messages: string[]; reload: boolean };

/** What went wrong, from either action, as a list of messages and whether reloading helps. */
function problemOf(state: MarkInvoicedState | UnmarkInvoicedState): Problem | null {
  if (!state || state.ok) {
    return null;
  }
  if ("kind" in state) {
    return state.kind === "error"
      ? { messages: [state.message], reload: false }
      : { messages: state.problems, reload: state.reload };
  }
  return { messages: [state.message], reload: state.reload };
}

function ProblemAlert({ problem }: { problem: Problem }) {
  return (
    <Alert
      variant="destructive"
      className="border-red-200 bg-red-50 text-red-900 *:data-[slot=alert-description]:text-red-900"
    >
      <AlertDescription>
        {problem.messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
        {problem.reload ? (
          <Button
            type="button"
            variant="outline"
            className="mt-2 h-11 border-red-300 bg-white px-4 text-red-900 md:h-10"
            onClick={() => window.location.reload()}
          >
            {TASK_ACTION_MESSAGES.reload}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The invoicing button of B3 (design chapter 3): "Markeer als gefactureerd" for an Afgewerkt
 * task, "Markering ongedaan maken" for a Gefactureerd one, each with its confirmation dialog.
 * Nothing for other statuses. Success redirects to the task page with a confirmation.
 */
export function TaskInvoiceActions({ number, version, status }: Props) {
  if (status === "completed") {
    return <MarkButton number={number} version={version} />;
  }
  if (status === "invoiced") {
    return <UnmarkButton number={number} version={version} />;
  }
  return null;
}

function MarkButton({ number, version }: { number: number; version: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<MarkInvoicedState, FormData>(
    markInvoiced,
    null,
  );
  const problem = problemOf(state);

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" className="h-11 px-4 md:h-10">
          {INVOICE_MESSAGES.taskButton}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="view" value="task" />
          <input
            type="hidden"
            name={INVOICE_TASK_FIELD}
            value={formatTaskRef({ number, version })}
          />
          <DialogHeader>
            <DialogTitle>{INVOICE_MESSAGES.taskDialogTitle}</DialogTitle>
            <DialogDescription>{INVOICE_MESSAGES.taskDialogText}</DialogDescription>
          </DialogHeader>
          {problem ? <ProblemAlert problem={problem} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                className="h-11 px-4 md:h-10"
              >
                {INVOICE_MESSAGES.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="h-11 px-4 md:h-10">
              {pending ? INVOICE_MESSAGES.confirming : INVOICE_MESSAGES.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnmarkButton({ number, version }: { number: number; version: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<UnmarkInvoicedState, FormData>(
    unmarkInvoiced,
    null,
  );
  const problem = problemOf(state);

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 px-4 md:h-10">
          {INVOICE_MESSAGES.unmarkButton}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="space-y-4">
          <input
            type="hidden"
            name={INVOICE_TASK_FIELD}
            value={formatTaskRef({ number, version })}
          />
          <DialogHeader>
            <DialogTitle>{INVOICE_MESSAGES.unmarkDialogTitle}</DialogTitle>
            <DialogDescription>{INVOICE_MESSAGES.unmarkDialogText}</DialogDescription>
          </DialogHeader>
          {problem ? <ProblemAlert problem={problem} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                className="h-11 px-4 md:h-10"
              >
                {INVOICE_MESSAGES.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="h-11 px-4 md:h-10">
              {pending ? INVOICE_MESSAGES.unmarkConfirming : INVOICE_MESSAGES.unmarkConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
