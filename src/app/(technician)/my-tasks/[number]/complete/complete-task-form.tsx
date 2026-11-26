"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { FieldError } from "@/components/field-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { telHref } from "@/lib/phone";
import { MAX_WORKED_MINUTES } from "@/lib/tasks/limits";
import { formatTaskNumber } from "@/lib/tasks/labels";
import { COMPLETE_MESSAGES, PICK_UP_MESSAGES, TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { relativeDay } from "@/lib/tasks/my-tasks-groups";
import {
  formatDate,
  formatHours,
  formatHoursSpoken,
  formatTimeOfDay,
  QUARTER_MINUTES,
} from "@/lib/time/format";
import { cn } from "@/lib/utils";
import { myTasksHref } from "@/lib/validation/my-tasks";

import { completeTask, type CompleteTaskState } from "../../actions";

const QUICK_MINUTES = [30, 60, 90, 120] as const;

const ROUND_BUTTON =
  "h-14 w-14 rounded-md border border-slate-300 bg-white text-2xl font-semibold text-slate-900 outline-none hover:bg-slate-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-white";

/** `vandaag 08:00`, `morgen 09:00` or `ma 23/11 10:00`. */
function plannedMoment(date: string, time: string, now: Date): string {
  const relative = relativeDay(date, now);
  const day =
    relative === "today"
      ? "vandaag"
      : relative === "tomorrow"
        ? "morgen"
        : formatDate(date, { omitCurrentYear: true, now });
  return `${day} ${formatTimeOfDay(time)}`;
}

/**
 * T3 (design chapter 3): the worked hours per quarter of an hour and the notes. The server
 * validates everything (Zod); this form shows what came back: a summary with the focus and a
 * message under the wrong field. The hours are a stepper (not a typed number) with quick
 * choices. The value is read out as "1 uur 30 minuten" (`formatHoursSpoken`) next to the big
 * `1u30`. The form is sent by hand, so a refused form keeps what was typed; the button waits
 * for React to take over the page. A task that moved meanwhile gives the messages of T2.
 */
export function CompleteTaskForm({
  taskNumber,
  version,
  customerName,
  scheduledDate,
  startTime,
  now,
  officePhone,
}: {
  taskNumber: number;
  /** The `updated_at` the page was opened with; the server refuses when the task changed. */
  version: string;
  customerName: string;
  scheduledDate: string;
  startTime: string;
  now: Date;
  officePhone?: string;
}) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(0);
  const [reloaded, setReloaded] = useState<CompleteTaskState>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [state, dispatch, pending] = useActionState<CompleteTaskState, FormData>(
    async (previous, formData) => {
      try {
        const result = await completeTask(previous, formData);
        if (result?.ok === false && result.kind === "cancelled") {
          // T2 shows the cancelled task; Back must not return here.
          router.replace(`/my-tasks/${taskNumber}`);
        }
        return result;
      } catch (error) {
        // A finished task redirects: Next lets the action promise fail with a redirect error.
        // That is a success, not a connection problem.
        unstable_rethrow(error);
        // No connection: nothing was sent that we know of. What he typed stays.
        return { ok: false, kind: "error", message: LOGIN_MESSAGES.technicalProblem };
      }
    },
    null,
  );

  // A refusal that the technician has dealt with ("Pagina herladen") is not shown again.
  const failed = state && state !== reloaded ? state : null;
  const fieldErrors = failed?.kind === "fields" ? failed.fieldErrors : {};
  const problem = failed && failed.kind !== "fields" ? failed : null;
  const taskMoved = problem?.kind === "not-assigned" || problem?.kind === "cancelled";

  useEffect(() => {
    if (failed) {
      noticeRef.current?.focus();
    }
  }, [failed]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  const spoken = minutes === 0 ? "nog geen uren" : formatHoursSpoken(minutes);
  const atMinimum = minutes === 0;
  const atMaximum = minutes >= MAX_WORKED_MINUTES;
  const hoursError = fieldErrors.workedMinutes;
  const notesError = fieldErrors.notes;

  return (
    <>
      <Link
        href={`/my-tasks/${taskNumber}`}
        className="-ml-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {COMPLETE_MESSAGES.backToTask}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{COMPLETE_MESSAGES.heading}</h1>
      <p className="mt-1 text-slate-700">
        Taak {formatTaskNumber(taskNumber)} · <span className="break-words">{customerName}</span> ·{" "}
        {plannedMoment(scheduledDate, startTime, now)}
      </p>

      {failed ? (
        // Focused, no `role="alert"`: it would be read twice (the other screens do the same).
        <div
          ref={noticeRef}
          id="complete-problem"
          tabIndex={-1}
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <p className="font-medium">{failed.message}</p>
          {problem?.kind === "not-assigned" ? (
            <p className="mt-1">
              {officePhone ? (
                <>
                  {PICK_UP_MESSAGES.callOfficeIfWrong}:{" "}
                  <a
                    href={telHref(officePhone)}
                    className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
                  >
                    {officePhone}
                  </a>
                  .
                </>
              ) : (
                `${PICK_UP_MESSAGES.callOfficeIfWrong}.`
              )}
            </p>
          ) : null}
          {problem?.kind === "changed" ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 border-red-300 bg-white px-4 text-red-900"
              onClick={() => {
                setReloaded(state);
                router.refresh();
              }}
            >
              {TASK_ACTION_MESSAGES.reload}
            </Button>
          ) : null}
          {taskMoved ? (
            <Button
              asChild
              variant="outline"
              className="mt-3 h-11 border-red-300 bg-white px-4 text-red-900"
            >
              <Link href={myTasksHref("todo")}>{PICK_UP_MESSAGES.backToMyTasks}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {taskMoved ? null : (
        // `noValidate`: the browser would show its own (English) messages; the server validates.
        <form
          onSubmit={submit}
          noValidate
          autoComplete="off"
          data-hydrated={hydrated ? "true" : undefined}
          className="mt-5 space-y-6"
        >
          <input type="hidden" name="taskNumber" value={taskNumber} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="workedMinutes" value={minutes} />

          <fieldset
            className="rounded-lg border border-border bg-card p-4"
            aria-describedby={cn("hours-help", hoursError && "hours-error")}
          >
            <legend className="px-1 text-base font-semibold">
              {COMPLETE_MESSAGES.hoursLegend}{" "}
              <span className="text-red-700" aria-hidden="true">
                *
              </span>
            </legend>
            <p id="hours-help" className="text-sm text-slate-600">
              {COMPLETE_MESSAGES.hoursHelp}
            </p>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                aria-label={COMPLETE_MESSAGES.lessLabel}
                aria-disabled={atMinimum}
                className={ROUND_BUTTON}
                onClick={() => setMinutes((value) => Math.max(0, value - QUARTER_MINUTES))}
              >
                −
              </button>
              {/* Seen as `1u30`, read as "1 uur 30 minuten"; announced when it changes. */}
              <output aria-live="polite" className="text-4xl font-semibold tabular-nums">
                <span aria-hidden="true" data-testid="hours-value">
                  {formatHours(minutes)}
                </span>
                <span className="sr-only">{spoken}</span>
              </output>
              <button
                type="button"
                aria-label={COMPLETE_MESSAGES.moreLabel}
                aria-disabled={atMaximum}
                className={ROUND_BUTTON}
                onClick={() =>
                  setMinutes((value) => Math.min(MAX_WORKED_MINUTES, value + QUARTER_MINUTES))
                }
              >
                +
              </button>
            </div>
            <p className="mt-1 text-center text-xs text-slate-600">
              {COMPLETE_MESSAGES.perQuarter}
            </p>

            <div
              className="mt-4 grid grid-cols-4 gap-2"
              role="group"
              aria-label={COMPLETE_MESSAGES.quickGroup}
            >
              {QUICK_MINUTES.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  aria-pressed={minutes === quick}
                  className="h-11 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-900 outline-none hover:bg-slate-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary"
                  onClick={() => setMinutes(quick)}
                >
                  {formatHours(quick)}
                </button>
              ))}
            </div>
            <FieldError id="hours-error" message={hoursError} />
          </fieldset>

          <div className="rounded-lg border border-border bg-card p-4">
            <Label htmlFor="notes" className="text-base font-semibold">
              {COMPLETE_MESSAGES.notesLabel}{" "}
              <span className="font-normal text-slate-600">{COMPLETE_MESSAGES.notesOptional}</span>
            </Label>
            <Textarea
              id="notes"
              name="notes"
              rows={5}
              placeholder={COMPLETE_MESSAGES.notesPlaceholder}
              aria-invalid={notesError ? true : undefined}
              aria-describedby={cn("notes-hint", notesError && "notes-error")}
              className="mt-2 placeholder:text-slate-500"
            />
            <p id="notes-hint" className="mt-1 text-xs text-slate-600">
              {COMPLETE_MESSAGES.notesHint}
            </p>
            <FieldError id="notes-error" message={notesError} />
          </div>

          <div className="space-y-2">
            <Button
              type="submit"
              disabled={pending || !hydrated}
              className="h-12 w-full text-base font-semibold"
            >
              {pending ? COMPLETE_MESSAGES.submitting : COMPLETE_MESSAGES.submit}
            </Button>
            <Link
              href={`/my-tasks/${taskNumber}`}
              className="flex h-12 items-center justify-center rounded-md text-base font-medium text-slate-700 underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {COMPLETE_MESSAGES.cancel}
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
