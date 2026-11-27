"use client";

import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  type FormEvent,
  type RefObject,
  useState,
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CORRECTION_REASON_MAX_LENGTH, MAX_CORRECTED_MINUTES } from "@/lib/tasks/limits";
import { CORRECT_HOURS_MESSAGES, TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { formatHours, QUARTER_MINUTES } from "@/lib/time/format";

import { correctHours, type CorrectHoursState } from "./actions";

export type CorrectHoursDialogProps = {
  taskNumber: number;
  /** The `updated_at` the page was opened with; the server refuses when the task changed. */
  version: string;
  /** Who filled in the hours, and what he filled in: stays visible (assumption A19). */
  completedByName: string;
  workedMinutes: number;
  /** The hours that count now (an earlier correction, else the technician's): the default choice. */
  currentMinutes: number;
};

const OPTIONS = Array.from(
  { length: MAX_CORRECTED_MINUTES / QUARTER_MINUTES },
  (_, index) => (index + 1) * QUARTER_MINUTES,
);

/**
 * The button "Uren corrigeren" and its dialog on B3 (design B3, Afgewerkt). Built like the dialog
 * of "Terugzetten": the form lives in `CorrectForm`, which exists only while the dialog is open,
 * and is sent by hand (`onSubmit`) so that a refusal keeps what was chosen and typed. After a
 * correction the server redirects to the page with the new version; the page gives this component
 * another `key`, so it starts closed.
 */
export function CorrectHoursDialog(props: CorrectHoursDialogProps) {
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
        <Button type="button" variant="outline" className="h-11 px-4 md:h-10">
          {CORRECT_HOURS_MESSAGES.button}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <CorrectForm {...props} close={() => setOpen(false)} pendingRef={pendingRef} />
      </DialogContent>
    </Dialog>
  );
}

function CorrectForm({
  taskNumber,
  version,
  completedByName,
  workedMinutes,
  currentMinutes,
  close,
  pendingRef,
}: CorrectHoursDialogProps & { close: () => void; pendingRef: RefObject<boolean> }) {
  const router = useRouter();
  const alertRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [state, dispatch, pending] = useActionState<CorrectHoursState, FormData>(
    correctHours,
    null,
  );
  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending, pendingRef]);

  // After a refusal the focus goes to the message or the wrong field, so a screen reader reads it.
  useEffect(() => {
    if (failed?.formError) {
      alertRef.current?.focus();
    } else if (failed?.fieldErrors.reason) {
      reasonRef.current?.focus();
    }
  }, [failed]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // Already now, not after the next render: the dialog must not close while the answer is on its way.
    pendingRef.current = true;
    startTransition(() => dispatch(data));
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <input type="hidden" name="taskNumber" value={taskNumber} />
      <input type="hidden" name="version" value={version} />
      <DialogHeader>
        <DialogTitle>{CORRECT_HOURS_MESSAGES.dialogTitle}</DialogTitle>
        <DialogDescription className="text-slate-700">
          {CORRECT_HOURS_MESSAGES.filledInBy(completedByName)}{" "}
          <strong>{formatHours(workedMinutes)}</strong>.{" "}
          {CORRECT_HOURS_MESSAGES.originalStaysVisible}
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
        <Label htmlFor="correct-minutes" className="block">
          {CORRECT_HOURS_MESSAGES.newHours}{" "}
          <span className="text-red-700" aria-hidden="true">
            *
          </span>
        </Label>
        <NativeSelect
          id="correct-minutes"
          name="correctedMinutes"
          defaultValue={String(currentMinutes)}
          aria-invalid={errors.correctedMinutes ? true : undefined}
          aria-describedby={describedBy(
            "correct-minutes-hint",
            errors.correctedMinutes && "correct-minutes-error",
          )}
          className="mt-1 h-11 w-40 md:h-10"
        >
          {OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {formatHours(minutes)}
            </option>
          ))}
        </NativeSelect>
        <p id="correct-minutes-hint" className="mt-1 text-xs text-muted-foreground">
          {CORRECT_HOURS_MESSAGES.newHoursHint}
        </p>
        <FieldError id="correct-minutes-error" message={errors.correctedMinutes} />
      </div>

      <div>
        <Label htmlFor="correct-reason" className="block">
          {CORRECT_HOURS_MESSAGES.reason}{" "}
          <span className="text-red-700" aria-hidden="true">
            *
          </span>
        </Label>
        <Textarea
          id="correct-reason"
          ref={reasonRef}
          name="reason"
          maxLength={CORRECTION_REASON_MAX_LENGTH}
          rows={3}
          placeholder={CORRECT_HOURS_MESSAGES.reasonPlaceholder}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={describedBy(errors.reason && "correct-reason-error")}
          className="mt-1"
        />
        <FieldError id="correct-reason-error" message={errors.reason} />
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          className="h-11 md:h-10"
          onClick={close}
        >
          {CORRECT_HOURS_MESSAGES.cancel}
        </Button>
        <Button type="submit" disabled={pending} className="h-11 md:h-10">
          {pending ? CORRECT_HOURS_MESSAGES.confirming : CORRECT_HOURS_MESSAGES.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}
