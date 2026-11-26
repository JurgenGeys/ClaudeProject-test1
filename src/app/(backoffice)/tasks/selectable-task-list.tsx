"use client";

import { useActionState, useState, type ReactNode } from "react";

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
import type { TaskOverviewRow } from "@/lib/tasks/overview";
import { formatTaskRef, INVOICE_TASK_FIELD } from "@/lib/validation/invoice";

import { markInvoiced, type MarkInvoicedState } from "./invoice-actions";
import { useSetInvoicingNotice } from "./invoicing-notice";
import { TaskList } from "./task-list";

/**
 * The list of the tab Afgewerkt with checkboxes and the bar "N taken geselecteerd — Markeer als
 * gefactureerd" (design B1; BT-17). The selection is per page: it holds the ids of the rows of
 * this page, and what counts is always the rows that are on the page now. `children` (the
 * pagination) is shown under the list and above the bar. The count sits in a live region that is
 * always in the page, so a screen reader announces it as the selection changes (only the count is live, not the whole bar).
 */
export function SelectableTaskList({
  rows,
  children,
}: {
  rows: TaskOverviewRow[];
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const chosen = rows.filter((row) => selected.has(row.id));
  const count = chosen.length;

  function toggle(row: TaskOverviewRow) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(row.id)) {
        next.add(row.id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(count === rows.length ? new Set() : new Set(rows.map((row) => row.id)));
  }

  return (
    <>
      <TaskList
        rows={rows}
        completed
        selection={{ selected, onToggle: toggle, onToggleAll: toggleAll }}
      />
      {children}
      {count > 0 ? <div aria-hidden="true" className="h-20" /> : null}
      {/* The wrapper and the count are always in the page, so a screen reader announces a change. */}
      <div
        className={
          count > 0
            ? "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background shadow-lg"
            : undefined
        }
      >
        <div
          className={
            count > 0
              ? "mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
              : undefined
          }
        >
          <p aria-live="polite" className={count > 0 ? "text-sm font-medium" : "sr-only"}>
            {count > 0 ? INVOICE_MESSAGES.selectedCount(count) : ""}
          </p>
          {count > 0 ? <MarkDialog chosen={chosen} onDone={() => setSelected(new Set())} /> : null}
        </div>
      </div>
    </>
  );
}

function MarkDialog({ chosen, onDone }: { chosen: TaskOverviewRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const setNotice = useSetInvoicingNotice();

  const [state, formAction, pending] = useActionState<MarkInvoicedState, FormData>(
    async (previous, formData) => {
      const result = await markInvoiced(previous, formData);
      if (result?.ok) {
        setNotice({ success: result.success, problems: result.problems });
      } else if (result && result.kind === "nothing") {
        setNotice({
          success: null,
          problems: [INVOICE_MESSAGES.nothingMarked, ...result.problems],
        });
      }
      if (result && (result.ok || result.kind === "nothing")) {
        setOpen(false);
        onDone();
      }
      return result;
    },
    null,
  );
  const failed = state && !state.ok && state.kind === "error" ? state.message : null;
  const count = chosen.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="h-11 px-4 md:h-10">
          {INVOICE_MESSAGES.barButton}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="view" value="list" />
          {chosen.map((row) => (
            <input
              key={row.id}
              type="hidden"
              name={INVOICE_TASK_FIELD}
              value={formatTaskRef({ number: row.number, version: row.version })}
            />
          ))}
          <DialogHeader>
            <DialogTitle>{INVOICE_MESSAGES.dialogTitle(count)}</DialogTitle>
            <DialogDescription>{INVOICE_MESSAGES.dialogText(count)}</DialogDescription>
          </DialogHeader>
          {failed ? (
            <Alert
              variant="destructive"
              className="border-red-200 bg-red-50 text-red-900 *:data-[slot=alert-description]:text-red-900"
            >
              <AlertDescription>{failed}</AlertDescription>
            </Alert>
          ) : null}
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
