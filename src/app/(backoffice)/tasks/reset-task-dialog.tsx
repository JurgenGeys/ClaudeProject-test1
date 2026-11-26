"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { FieldError } from "@/components/field-error";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RESET_MESSAGES, TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { QUARTER_MINUTES } from "@/lib/time/format";

import { resetTask, type ResetTaskState } from "./actions";

export type ResetTaskDialogProps = {
  taskNumber: number;
  /** The `updated_at` the page was opened with; the server refuses when the task changed. */
  version: string;
  /** The technicians that can be chosen: active, with a password (design B3). */
  technicians: readonly { id: string; fullName: string }[];
  /** The current technician: the default choice, when he can still be chosen. */
  currentAssigneeId: string | null;
  /** `2026-11-24` and `08:00`: the defaults of date and start time. */
  scheduledDate: string;
  startTime: string;
};

function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter(Boolean).join(" ");
  return present === "" ? undefined : present;
}

/**
 * The button "Terugzetten" and its dialog on B3 (design B3, Opgepikt). The dialog is a Radix
 * dialog: the focus moves into it (to the technician), stays inside, Escape closes it and the
 * focus returns to the button. A refusal stays in the dialog, with the message under the field;
 * when the task changed meanwhile the dialog offers "Pagina herladen". After a reset the server
 * redirects to the page with the new version; the page gives this component another `key`, so
 * it starts closed.
 */
export function ResetTaskDialog({
  taskNumber,
  version,
  technicians,
  currentAssigneeId,
  scheduledDate,
  startTime,
}: ResetTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useActionState<ResetTaskState, FormData>(resetTask, null);

  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};
  const currentIsChoosable = technicians.some((technician) => technician.id === currentAssigneeId);

  // After a refusal that has no field, the focus goes to the message, so a screen reader reads it.
  useEffect(() => {
    if (failed?.formError && alertRef.current) {
      alertRef.current.focus();
    }
  }, [failed]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next); // Do not close while the answer is on its way.
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="h-11 px-4 md:h-10">
          {RESET_MESSAGES.button}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="taskNumber" value={taskNumber} />
          <input type="hidden" name="version" value={version} />
          <DialogHeader>
            <DialogTitle>{RESET_MESSAGES.dialogTitle}</DialogTitle>
            <DialogDescription className="text-slate-700">
              {RESET_MESSAGES.dialogIntro} <strong>Toegewezen</strong>. {RESET_MESSAGES.dialogOutro}
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
                      setOpen(false);
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
            <Label htmlFor="reset-assignee" className="block">
              {RESET_MESSAGES.technician}
            </Label>
            <NativeSelect
              id="reset-assignee"
              name="assigneeId"
              defaultValue={currentIsChoosable ? (currentAssigneeId ?? "") : ""}
              aria-invalid={errors.assigneeId ? true : undefined}
              aria-describedby={describedBy(errors.assigneeId && "reset-assignee-error")}
              className="mt-1 h-11 md:h-10"
            >
              {currentIsChoosable ? null : (
                <option value="">{RESET_MESSAGES.chooseTechnician}</option>
              )}
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.fullName}
                </option>
              ))}
            </NativeSelect>
            <FieldError id="reset-assignee-error" message={errors.assigneeId} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reset-date" className="block">
                {RESET_MESSAGES.date}
              </Label>
              <Input
                id="reset-date"
                name="scheduledDate"
                type="date"
                defaultValue={scheduledDate}
                aria-invalid={errors.scheduledDate ? true : undefined}
                aria-describedby={describedBy(errors.scheduledDate && "reset-date-error")}
                className="mt-1 h-11 md:h-10"
              />
              <FieldError id="reset-date-error" message={errors.scheduledDate} />
            </div>
            <div>
              <Label htmlFor="reset-time" className="block">
                {RESET_MESSAGES.startTime}
              </Label>
              <Input
                id="reset-time"
                name="startTime"
                type="time"
                step={QUARTER_MINUTES * 60}
                defaultValue={startTime}
                aria-invalid={errors.startTime ? true : undefined}
                aria-describedby={describedBy(errors.startTime && "reset-time-error")}
                className="mt-1 h-11 md:h-10"
              />
              <FieldError id="reset-time-error" message={errors.startTime} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="h-11 md:h-10"
              onClick={() => setOpen(false)}
            >
              {RESET_MESSAGES.cancel}
            </Button>
            <Button type="submit" disabled={pending} className="h-11 md:h-10">
              {pending ? RESET_MESSAGES.confirming : RESET_MESSAGES.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
