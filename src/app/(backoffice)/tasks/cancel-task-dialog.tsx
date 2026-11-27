"use client";

import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { describedBy, FieldError } from "@/components/field-error";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CANCEL_MESSAGES } from "@/lib/tasks/cancel-messages";
import { CANCELLATION_REASON_MAX_LENGTH } from "@/lib/tasks/limits";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";

import { cancelTask, type CancelTaskState } from "./cancel-actions";

export type CancelTaskDialogProps = {
  taskNumber: number;
  /** `#1043`, as the page shows it. */
  taskLabel: string;
  /** The `updated_at` the page was opened with; the server refuses when the task changed. */
  version: string;
  /** The technician of a Toegewezen task; `null` for an Open task (the text then leaves him out). */
  assigneeName: string | null;
};

/**
 * The button "Taak annuleren" and its dialog on B3 (design B3, Open and Toegewezen). The dialog
 * is a Radix dialog: the focus moves into it, stays inside, Escape closes it and the focus
 * returns to the button. The way out is "Taak behouden" (not "Annuleren", which would be
 * confusing here). A refusal stays in the dialog; when the task changed meanwhile, or the
 * technician picked it up, the dialog offers "Pagina herladen". After a cancellation the server
 * redirects to the page with the new version; the page gives this component another `key`, so
 * it starts closed.
 *
 * The form lives in `CancelForm`, which exists only while the dialog is open: closing wipes the
 * reason and the message of an earlier attempt. The form is sent by hand (`onSubmit`) instead
 * of with `action={...}` because React clears a form after an action, and a refused dialog must
 * keep the reason that was typed.
 */
export function CancelTaskDialog(props: CancelTaskDialogProps) {
  const [open, setOpen] = useState(false);
  // Set by the form while an answer is on its way: the dialog does not close then.
  const pendingRef = useRef(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pendingRef.current) {
          setOpen(next);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4 text-red-700 hover:bg-red-50 hover:text-red-800 md:h-10"
        >
          {CANCEL_MESSAGES.button}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <CancelForm {...props} close={() => setOpen(false)} pendingRef={pendingRef} />
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({
  taskNumber,
  taskLabel,
  version,
  assigneeName,
  close,
  pendingRef,
}: CancelTaskDialogProps & { close: () => void; pendingRef: RefObject<boolean> }) {
  const router = useRouter();
  const alertRef = useRef<HTMLDivElement>(null);
  const [state, dispatch, pending] = useActionState<CancelTaskState, FormData>(cancelTask, null);

  const failed = state && !state.ok ? state : null;
  const reasonError = failed?.fieldErrors.reason;

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending, pendingRef]);

  // After a refusal that has no field, the focus goes to the message, so a screen reader reads it.
  useEffect(() => {
    if (failed?.formError && alertRef.current) {
      alertRef.current.focus();
    }
  }, [failed]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <input type="hidden" name="taskNumber" value={taskNumber} />
      <input type="hidden" name="version" value={version} />
      <DialogHeader>
        <DialogTitle>{CANCEL_MESSAGES.dialogTitle(taskLabel)}</DialogTitle>
        <DialogDescription asChild className="text-slate-700">
          <div className="space-y-2">
            <p>
              {CANCEL_MESSAGES.dialogIntroStart}
              {assigneeName ? (
                <>
                  {" "}
                  {CANCEL_MESSAGES.dialogIntroTechnician} <strong>{assigneeName}</strong>
                </>
              ) : null}
              . {CANCEL_MESSAGES.dialogIntroEnd}
            </p>
            <p>{CANCEL_MESSAGES.dialogWarning}</p>
          </div>
        </DialogDescription>
      </DialogHeader>

      {failed?.formError ? (
        <Alert
          ref={alertRef}
          tabIndex={-1}
          variant="destructive"
          className="border-red-200 bg-red-50 text-red-900 outline-none *:data-[slot=alert-description]:text-red-900"
        >
          <AlertDescription>
            <p>{failed.formError}</p>
            {failed.reload ? (
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-11 border-red-300 bg-white px-4 text-red-900 md:h-10"
                onClick={() => {
                  close();
                  router.refresh();
                }}
              >
                {TASK_ACTION_MESSAGES.reload}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Label htmlFor="cancel-reason" className="block">
          {CANCEL_MESSAGES.reason}
          <span className="font-normal text-slate-700">{CANCEL_MESSAGES.reasonOptional}</span>
        </Label>
        <Textarea
          id="cancel-reason"
          name="reason"
          rows={2}
          maxLength={CANCELLATION_REASON_MAX_LENGTH}
          placeholder={CANCEL_MESSAGES.reasonPlaceholder}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={describedBy(reasonError && "cancel-reason-error")}
          className="mt-1 min-h-20 placeholder:text-slate-600"
        />
        <FieldError id="cancel-reason-error" message={reasonError} />
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          className="h-11 md:h-10"
          onClick={close}
        >
          {CANCEL_MESSAGES.keep}
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={pending}
          className="h-11 bg-red-700 text-white hover:bg-red-800 md:h-10"
        >
          {pending ? CANCEL_MESSAGES.confirming : CANCEL_MESSAGES.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}
