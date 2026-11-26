import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { telHref } from "@/lib/phone";
import type { TaskDetail } from "@/lib/tasks/detail";
import { formatTaskNumber, workTypeLabel } from "@/lib/tasks/labels";
import { COMPLETE_MESSAGES } from "@/lib/tasks/messages";
import { relativeDay } from "@/lib/tasks/my-tasks-groups";
import { formatMoment } from "@/lib/tasks/timeline";
import { formatDate, formatHours, formatTime, formatTimeOfDay } from "@/lib/time/format";
import { myTasksHref } from "@/lib/validation/my-tasks";
import { cn } from "@/lib/utils";

import { CallOffice } from "./call-office";
import { CompleteBar } from "./complete-bar";
import {
  CANCELLED_HEADING_ID,
  PICKED_UP_NOTICE_ID,
  PickUpAlert,
  PickUpBar,
  PickUpTask,
} from "./pick-up-task";

const CARD = "mt-3 rounded-lg border border-border bg-card p-4";

function Block({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(CARD, className)} aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold text-slate-600">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Instructions and notes are written on several lines. */
function Multiline({ text, className }: { text: string; className?: string }) {
  return <p className={cn("mt-1 whitespace-pre-line", className)}>{text}</p>;
}

/** `Vandaag, ma 23/11 om 08:00`, `Morgen, di 24/11 om 09:00` or `do 19/11 om 10:00`. */
function plannedMoment(task: TaskDetail, now: Date) {
  const date = formatDate(task.scheduledDate, { omitCurrentYear: true, now });
  const relative = relativeDay(task.scheduledDate, now);
  const prefix = relative === "today" ? "Vandaag, " : relative === "tomorrow" ? "Morgen, " : "";
  return (
    <>
      {prefix}
      {date} om <strong>{formatTimeOfDay(task.startTime)}</strong>
    </>
  );
}

/** A big, plain link of at least 44 px, like the buttons of the design. */
function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
}

/**
 * T2 for a task that is cancelled meanwhile (design T2, "Foutmeldingen"): only the message,
 * no details of a task that does not need doing any more.
 */
function CancelledTask({ task }: { task: TaskDetail }) {
  return (
    <>
      <BackLink href={myTasksHref("todo")}>← Mijn taken</BackLink>
      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status="cancelled" />
        <span className="text-sm text-slate-600">Taak {formatTaskNumber(task.number)}</span>
      </div>
      {/* A plain section, not an alert: this is the page itself on load, not a change to announce. */}
      <section
        aria-labelledby={CANCELLED_HEADING_ID}
        className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        <h1 id={CANCELLED_HEADING_ID} tabIndex={-1} className="font-medium outline-none">
          Deze taak is geannuleerd door kantoor.
        </h1>
        <p className="mt-1">Je hoeft niets meer te doen.</p>
        <Button asChild variant="outline" className="mt-3 h-11 bg-white px-4">
          <Link href={myTasksHref("todo")}>Terug naar mijn taken</Link>
        </Button>
      </section>
    </>
  );
}

/**
 * T2 (design chapter 3): what the technician needs to do the task. A Toegewezen task has the
 * button Oppikken with its confirmation (BT-12); an Opgepikt task has the button Afmelden, a link to T3 (BT-13). Phone and maps links
 * with their own buttons come with BT-19; the phone number is already a plain `tel:` link.
 * A finished task (Afgewerkt or Gefactureerd, both "Afgewerkt" here) shows the technician's
 * own report, with the hours he filled in. A cancelled task shows only that message.
 */
export function MyTaskView({
  task,
  now,
  officePhone,
}: {
  task: TaskDetail;
  now: Date;
  /** Phone number of the office (`COMPANY_PHONE`); without it the sentences about calling are left out. */
  officePhone?: string;
}) {
  if (task.status === "cancelled") {
    return <CancelledTask task={task} />;
  }
  const finished = task.status === "completed" || task.status === "invoiced";
  const status = finished ? "completed" : task.status;
  const completion = finished ? task.completion : null;
  const canPickUp = task.status === "assigned";

  const content = (
    <>
      <BackLink href={myTasksHref(finished ? "done" : "todo")}>
        {finished ? "← Afgewerkt" : "← Mijn taken"}
      </BackLink>
      {canPickUp ? <PickUpAlert officePhone={officePhone} /> : null}

      {task.status === "picked_up" && task.pickedUpAt ? (
        <div
          id={PICKED_UP_NOTICE_ID}
          tabIndex={-1}
          role="status"
          className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <p className="font-medium">Opgepikt om {formatTime(task.pickedUpAt)}</p>
          <p>Kantoor ziet dat je onderweg of bezig bent. {COMPLETE_MESSAGES.pickedUpNoticeHint}</p>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <StatusBadge status={status} />
        <span className="text-sm text-slate-600">Taak {formatTaskNumber(task.number)}</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight break-words">
        {task.customer.name}
      </h1>
      <p className="mt-1 text-base font-medium">{workTypeLabel(task.workType)}</p>
      <p className="mt-1 text-lg">{plannedMoment(task, now)}</p>
      {task.estimatedMinutes !== null ? (
        <p className="text-sm text-slate-600">
          Geschatte duur: {formatHours(task.estimatedMinutes)}
        </p>
      ) : null}

      {completion ? (
        <Block
          id="heading-completion"
          title="Jouw afmelding"
          className="border-green-200 bg-green-50"
        >
          <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-700">Gewerkte uren</dt>
            <dd className="text-right text-lg font-semibold">
              {formatHours(completion.workedMinutes)}
            </dd>
            {task.pickedUpAt ? (
              <>
                <dt className="text-slate-700">Opgepikt</dt>
                <dd className="text-right">{formatMoment(task.pickedUpAt, now)}</dd>
              </>
            ) : null}
            <dt className="text-slate-700">Afgemeld</dt>
            <dd className="text-right">{formatMoment(completion.completedAt, now)}</dd>
          </dl>
          <h3 className="mt-3 text-sm font-semibold text-green-900">Notities</h3>
          {completion.notes ? (
            <Multiline text={completion.notes} className="text-sm" />
          ) : (
            <p className="mt-1 text-sm text-slate-700 italic">Geen notities.</p>
          )}
          <p className="mt-3 text-xs text-slate-700">
            Een afgemelde taak kan je niet meer wijzigen.
            {officePhone ? (
              <>
                {" "}
                Klopt er iets niet? <CallOffice phone={officePhone} />
              </>
            ) : null}
          </p>
        </Block>
      ) : null}

      <Block id="heading-location" title="Locatie">
        <p className="mt-1 text-base">
          {task.locationStreet}
          <br />
          {task.locationPostalCode} {task.locationCity}
        </p>
      </Block>

      {finished ? null : (
        <Block id="heading-customer" title="Klant">
          <p className="mt-1 font-medium">{task.customer.name}</p>
          {task.customer.phone ? (
            <p className="mt-1">
              <a
                href={telHref(task.customer.phone)}
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {task.customer.phone}
              </a>
            </p>
          ) : null}
          {task.customer.notes ? (
            <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-slate-700">
              <span className="font-medium">Opmerking:</span> {task.customer.notes}
            </p>
          ) : null}
        </Block>
      )}

      <Block id="heading-instructions" title="Instructies">
        <Multiline text={task.instructions} className="text-base leading-relaxed" />
      </Block>

      {task.status === "picked_up" && officePhone ? (
        <p className="mt-4 text-sm text-slate-600">
          Kan je de taak niet uitvoeren, bv. omdat de klant niet thuis is?{" "}
          <CallOffice phone={officePhone} /> Kantoor zet de taak dan terug.
        </p>
      ) : null}
      {task.status === "picked_up" ? <CompleteBar taskNumber={task.number} /> : null}
      {canPickUp ? (
        <PickUpBar
          taskNumber={task.number}
          version={task.version}
          customerName={task.customer.name}
        />
      ) : null}
    </>
  );

  return canPickUp ? <PickUpTask>{content}</PickUpTask> : content;
}
