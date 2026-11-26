"use client";

import Link from "next/link";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerSearchResult } from "@/lib/customers/search";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import { MAX_ESTIMATED_MINUTES } from "@/lib/tasks/limits";
import { WORK_TYPE_LABELS } from "@/lib/tasks/labels";
import { workTypes } from "@/lib/tasks/types";
import type { WorkType } from "@/lib/tasks/types";
import { brusselsDayKey, formatHours, QUARTER_MINUTES } from "@/lib/time/format";
import { fieldSummary } from "@/lib/validation/field-summary";

import { createTask, updateTask, type TaskFormState } from "./actions";
import { CustomerPicker } from "./customer-picker";

export type TechnicianOption = { id: string; fullName: string };

/**
 * What the form starts from when an existing task is edited (design B2, edit mode): the task as
 * saved, and its `version` (see `updateTaskInTransaction`). Without it the form makes a new task.
 */
export type TaskFormEdit = {
  number: number;
  version: string;
  /** Opgepikt: the technician cannot be changed here (use Terugzetten). */
  status: "open" | "assigned" | "picked_up";
  customer: CustomerSearchResult;
  locationStreet: string;
  locationPostalCode: string;
  locationCity: string;
  workType: WorkType;
  instructions: string;
  /** `2026-11-24` and `14:00`. */
  scheduledDate: string;
  startTime: string;
  estimatedMinutes: number | null;
  assignee: TechnicianOption | null;
};

const ESTIMATED_DURATIONS = Array.from(
  { length: MAX_ESTIMATED_MINUTES / QUARTER_MINUTES },
  (_, index) => (index + 1) * QUARTER_MINUTES,
);

/** The ids of the messages a field refers to, or `undefined` when there are none. */
function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const used = ids.filter(Boolean).join(" ");
  return used || undefined;
}

function Required() {
  return (
    <span aria-hidden="true" className="text-red-700">
      *
    </span>
  );
}

const SECTION = "rounded-lg border border-border bg-card p-5";
const RADIO_LABEL =
  "flex h-11 cursor-pointer items-center gap-3 rounded-md border border-input bg-background px-3 text-sm font-medium has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50";

/**
 * The form of "Nieuwe taak" and "Taak bewerken" (design B2). The server validates everything; the form only shows
 * what came back: a summary with the focus, and a message under every wrong field.
 *
 * The form is sent by hand (`onSubmit`) instead of with `action={...}`: React clears a form
 * after an action, and a refused form must keep what was typed. The button is disabled until
 * React has taken over the page, so a click or the Enter key never sends a plain form post.
 */
export function TaskForm({
  technicians,
  edit,
  customer,
}: {
  technicians: readonly TechnicianOption[];
  edit?: TaskFormEdit;
  /** A new task that starts with this customer chosen and his address as location ("Nieuwe taak voor deze klant"). */
  customer?: CustomerSearchResult;
}) {
  const [state, dispatch, pending] = useActionState<TaskFormState, FormData>(
    edit ? updateTask : createTask,
    null,
  );
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [pastDate, setPastDate] = useState(
    edit ? edit.scheduledDate < brusselsDayKey(new Date()) : false,
  );
  const alertRef = useRef<HTMLDivElement>(null);
  const streetRef = useRef<HTMLInputElement>(null);
  const postalCodeRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);

  const assigneeLocked = edit?.status === "picked_up";
  // The current technician stays selectable even if he is no longer offered (he was switched
  // off): saving then says so, instead of silently moving the task to nobody.
  const assigneeOptions =
    edit?.assignee && !technicians.some((technician) => technician.id === edit.assignee?.id)
      ? [...technicians, edit.assignee]
      : technicians;

  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};
  const errorCount = Object.keys(errors).length;
  const summary =
    failed?.formError ??
    (errorCount > 0 ? `${TASK_ACTION_MESSAGES.notSaved} ${fieldSummary(errorCount)}` : undefined);

  // After a refused attempt the focus goes to the summary, so a screen reader reads it.
  useEffect(() => {
    if (failed && alertRef.current) {
      alertRef.current.focus();
    }
  }, [failed]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  function fillLocation(customer: CustomerSearchResult) {
    if (streetRef.current) streetRef.current.value = customer.street ?? "";
    if (postalCodeRef.current) postalCodeRef.current.value = customer.postalCode ?? "";
    if (cityRef.current) cityRef.current.value = customer.city ?? "";
  }

  return (
    // `noValidate`: the browser would show its own (English) messages; the server validates.
    <form
      onSubmit={submit}
      noValidate
      // A reload must not bring back what the browser remembers of an earlier version of the task.
      autoComplete={edit ? "off" : undefined}
      data-hydrated={hydrated ? "true" : undefined}
      className="mt-6 space-y-6"
    >
      {summary ? (
        <Alert
          ref={alertRef}
          variant="destructive"
          tabIndex={-1}
          className="border-red-200 bg-red-50 text-red-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 *:data-[slot=alert-description]:text-red-900"
        >
          <AlertDescription>
            {summary}
            {failed?.reload ? (
              <Button
                type="button"
                variant="outline"
                className="mt-2 block h-10 px-4"
                onClick={() => window.location.reload()}
              >
                {TASK_ACTION_MESSAGES.reload}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {edit ? (
        <>
          <input type="hidden" name="taskNumber" value={edit.number} />
          <input type="hidden" name="version" value={edit.version} />
        </>
      ) : null}

      <section className={SECTION} aria-labelledby="heading-customer">
        <h2 id="heading-customer" className="text-lg font-semibold">
          1. Klant <Required />
        </h2>
        <CustomerPicker
          errors={errors}
          onChoose={fillLocation}
          initialCustomer={edit?.customer ?? customer}
        />
      </section>

      <section className={SECTION} aria-labelledby="heading-location">
        <h2 id="heading-location" className="text-lg font-semibold">
          2. Locatie
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wordt ingevuld met het adres van de klant. Wijzig je het hier, dan geldt dat enkel voor
          deze taak.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_8rem_1fr]">
          <div className="sm:col-span-3">
            <Label htmlFor="location-street" className="block">
              Straat en nummer <Required />
            </Label>
            <Input
              ref={streetRef}
              defaultValue={edit?.locationStreet ?? customer?.street ?? undefined}
              id="location-street"
              name="locationStreet"
              aria-required="true"
              autoComplete="off"
              aria-invalid={errors.locationStreet ? true : undefined}
              aria-describedby={describedBy(errors.locationStreet && "location-street-error")}
              className="mt-1 h-10"
            />
            <FieldError id="location-street-error" message={errors.locationStreet} />
          </div>
          <div>
            <Label htmlFor="location-postal-code" className="block">
              Postcode <Required />
            </Label>
            <Input
              ref={postalCodeRef}
              defaultValue={edit?.locationPostalCode ?? customer?.postalCode ?? undefined}
              id="location-postal-code"
              name="locationPostalCode"
              aria-required="true"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              aria-invalid={errors.locationPostalCode ? true : undefined}
              aria-describedby={describedBy(
                errors.locationPostalCode && "location-postal-code-error",
              )}
              className="mt-1 h-10"
            />
            <FieldError id="location-postal-code-error" message={errors.locationPostalCode} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="location-city" className="block">
              Gemeente <Required />
            </Label>
            <Input
              ref={cityRef}
              defaultValue={edit?.locationCity ?? customer?.city ?? undefined}
              id="location-city"
              name="locationCity"
              aria-required="true"
              autoComplete="off"
              aria-invalid={errors.locationCity ? true : undefined}
              aria-describedby={describedBy(errors.locationCity && "location-city-error")}
              className="mt-1 h-10"
            />
            <FieldError id="location-city-error" message={errors.locationCity} />
          </div>
        </div>
      </section>

      <section className={SECTION} aria-labelledby="heading-task">
        <h2 id="heading-task" className="text-lg font-semibold">
          3. Taak
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <fieldset
            role="radiogroup"
            aria-required="true"
            className="sm:col-span-3"
            aria-invalid={errors.workType ? true : undefined}
            aria-describedby={describedBy(errors.workType && "work-type-error")}
          >
            <legend className="text-sm font-medium">
              Soort werk <Required />
            </legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {workTypes.map((workType) => (
                <label key={workType} className={RADIO_LABEL}>
                  <input
                    type="radio"
                    name="workType"
                    value={workType}
                    defaultChecked={edit?.workType === workType}
                    className="size-4 accent-primary"
                  />
                  {WORK_TYPE_LABELS[workType]}
                </label>
              ))}
            </div>
            <FieldError id="work-type-error" message={errors.workType} />
          </fieldset>

          <div className="sm:col-span-3">
            <Label htmlFor="instructions" className="block">
              Instructies <Required />
            </Label>
            <Textarea
              id="instructions"
              name="instructions"
              defaultValue={edit?.instructions}
              aria-required="true"
              rows={4}
              placeholder="Bv. Jaarlijks onderhoud 2 split-units (winkel en atelier)"
              aria-invalid={errors.instructions ? true : undefined}
              aria-describedby={describedBy(
                "instructions-hint",
                errors.instructions && "instructions-error",
              )}
              className="mt-1"
            />
            <p id="instructions-hint" className="mt-1 text-xs text-muted-foreground">
              De eerste regel verschijnt als korte omschrijving in de lijsten.
            </p>
            <FieldError id="instructions-error" message={errors.instructions} />
          </div>

          <div>
            <Label htmlFor="scheduled-date" className="block">
              Datum <Required />
            </Label>
            <Input
              id="scheduled-date"
              name="scheduledDate"
              defaultValue={edit?.scheduledDate}
              aria-required="true"
              type="date"
              onChange={(event) => {
                const value = event.target.value;
                setPastDate(value !== "" && value < brusselsDayKey(new Date()));
              }}
              aria-invalid={errors.scheduledDate ? true : undefined}
              aria-describedby={describedBy(
                errors.scheduledDate && "scheduled-date-error",
                pastDate && "scheduled-date-past",
              )}
              className="mt-1 h-10"
            />
            <FieldError id="scheduled-date-error" message={errors.scheduledDate} />
            {/* A past date is allowed (design B2): this is a warning, not an error. */}
            <p
              id="scheduled-date-past"
              role="status"
              className="mt-1 text-sm text-amber-800 empty:hidden"
            >
              {pastDate ? "Deze datum ligt in het verleden." : ""}
            </p>
          </div>

          <div>
            <Label htmlFor="start-time" className="block">
              Startuur <Required />
            </Label>
            <Input
              id="start-time"
              name="startTime"
              defaultValue={edit?.startTime}
              aria-required="true"
              type="time"
              step={QUARTER_MINUTES * 60}
              aria-invalid={errors.startTime ? true : undefined}
              aria-describedby={describedBy(errors.startTime && "start-time-error")}
              className="mt-1 h-10"
            />
            <FieldError id="start-time-error" message={errors.startTime} />
          </div>

          <div>
            <Label htmlFor="estimated-minutes" className="block">
              Geschatte duur
            </Label>
            <NativeSelect
              id="estimated-minutes"
              name="estimatedMinutes"
              defaultValue={edit?.estimatedMinutes ?? ""}
              aria-invalid={errors.estimatedMinutes ? true : undefined}
              aria-describedby={describedBy(errors.estimatedMinutes && "estimated-minutes-error")}
              className="mt-1 h-10"
            >
              <option value="">Niet ingevuld</option>
              {ESTIMATED_DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatHours(minutes)}
                </option>
              ))}
            </NativeSelect>
            <FieldError id="estimated-minutes-error" message={errors.estimatedMinutes} />
          </div>

          <div className="sm:col-span-3">
            <Label htmlFor="assignee" className="block">
              Technieker
            </Label>
            {assigneeLocked ? (
              <>
                {/* Disabled: nothing is sent, so the technician cannot be changed by this form. */}
                <NativeSelect
                  id="assignee"
                  disabled
                  aria-describedby="assignee-hint"
                  className="mt-1 h-10 sm:w-80"
                >
                  <option>{edit?.assignee?.fullName}</option>
                </NativeSelect>
                <p id="assignee-hint" className="mt-1 text-sm text-foreground">
                  {TASK_ACTION_MESSAGES.assigneeLocked}
                </p>
              </>
            ) : (
              <>
                <NativeSelect
                  id="assignee"
                  name="assigneeId"
                  defaultValue={edit?.assignee?.id ?? ""}
                  aria-invalid={errors.assigneeId ? true : undefined}
                  aria-describedby={describedBy(
                    "assignee-hint",
                    errors.assigneeId && "assignee-error",
                  )}
                  className="mt-1 h-10 sm:w-80"
                >
                  <option value="">Nog niet toewijzen</option>
                  {assigneeOptions.map((technician) => (
                    <option key={technician.id} value={technician.id}>
                      {technician.fullName}
                    </option>
                  ))}
                </NativeSelect>
                <p id="assignee-hint" className="mt-1 text-xs text-muted-foreground">
                  {edit?.assignee
                    ? `Kies je een andere technieker, dan verdwijnt de taak uit de lijst van ${edit.assignee.fullName} en verschijnt ze bij de nieuwe technieker. Kies je "Nog niet toewijzen", dan staat de taak terug op Open en ziet geen enkele technieker ze.`
                    : "Kies je een technieker, dan krijgt de taak de status Toegewezen en ziet hij ze meteen in zijn lijst."}
                </p>
              </>
            )}
            <FieldError id="assignee-error" message={errors.assigneeId} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !hydrated} className="h-10 px-5">
          {pending ? "Bezig met bewaren…" : edit ? "Wijzigingen bewaren" : "Taak bewaren"}
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link href={edit ? `/tasks/${edit.number}` : "/tasks"}>Annuleren</Link>
        </Button>
      </div>
    </form>
  );
}
