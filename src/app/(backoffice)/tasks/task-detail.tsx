import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { telHref } from "@/lib/phone";
import type { TaskDetail } from "@/lib/tasks/detail";
import { formatTaskNumber, workTypeLabel } from "@/lib/tasks/labels";
import { buildTimeline, formatMoment, type TimelineItem } from "@/lib/tasks/timeline";
import { RESET_MESSAGES } from "@/lib/tasks/messages";
import { canEditTask } from "@/lib/tasks/transitions";
import { formatDate, formatHours, formatTimeOfDay } from "@/lib/time/format";
import { cn } from "@/lib/utils";

import { ResetTaskDialog } from "./reset-task-dialog";
import { SavedNotice } from "./saved-notice";

const CARD = "rounded-lg border border-border bg-card p-5";

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
      <h2 id={id} className="text-sm font-semibold text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Text with the line breaks of the original (instructions and notes are written on several lines). */
function Multiline({ text, className }: { text: string; className?: string }) {
  return <p className={cn("mt-2 whitespace-pre-line", className)}>{text}</p>;
}

const EMPHASIS_CLASSES: Record<NonNullable<TimelineItem["emphasis"]>, string> = {
  picked_up: "text-amber-900",
  completed: "text-green-800",
  invoiced: "text-violet-800",
  cancelled: "text-red-800",
};

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="mt-3 space-y-3 border-l border-border pl-4 text-sm">
      {items.map((item) => (
        <li key={item.key} className={item.pending ? "text-muted-foreground" : undefined}>
          <p
            className={cn(
              !item.pending && "font-medium",
              item.emphasis && EMPHASIS_CLASSES[item.emphasis],
            )}
          >
            {item.title}
          </p>
          {item.detail ? <p className="text-muted-foreground">{item.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function Completion({ task, now }: { task: TaskDetail; now: Date }) {
  const completion = task.completion;
  if (!completion) {
    return null;
  }
  const corrected = completion.correctedMinutes !== null;
  return (
    <Block id="heading-completion" title="Afmelding" className="border-green-200">
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
        <p className="text-3xl font-semibold">
          {formatHours(completion.correctedMinutes ?? completion.workedMinutes)}
        </p>
        <p className="text-sm text-muted-foreground">gewerkte uren, zonder verplaatsing</p>
      </div>
      {corrected && completion.correctedAt ? (
        <div className="mt-3 rounded-md border border-border bg-muted/50 p-3 text-sm">
          <p>
            <span className="font-medium">Gecorrigeerd</span>
            {completion.correctedByName ? ` door ${completion.correctedByName}` : ""} op{" "}
            {formatMoment(completion.correctedAt, now)}.
          </p>
          <p>
            Oorspronkelijk door {completion.completedByName} ingevuld:{" "}
            <strong>{formatHours(completion.workedMinutes)}</strong>.
          </p>
          {completion.correctionReason ? (
            <p className="mt-1">Reden: {completion.correctionReason}</p>
          ) : null}
        </div>
      ) : null}
      <h3 className="mt-4 text-sm font-semibold text-muted-foreground">
        Notities van de technieker
      </h3>
      {completion.notes ? (
        <Multiline text={completion.notes} className="mt-1" />
      ) : (
        <p className="mt-1 text-muted-foreground italic">Geen notities.</p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Afgemeld door {completion.completedByName} op {formatMoment(completion.completedAt, now)}.
      </p>
    </Block>
  );
}

/**
 * B3 (design chapter 3): the task for the back office, read only. Shows the status and the
 * number, the customer, location, instructions and technician, the timeline and, from
 * Afgewerkt on, the completion. A cancelled task shows a grey bar with who, when and why.
 * The actions: "Bewerken" (Open, Toegewezen, Opgepikt) and "Terugzetten" with its dialog
 * (Opgepikt, BT-14); the other actions of the design (annuleren, uren corrigeren, factureren)
 * come with their own build tasks.
 */
export function TaskDetailView({
  task,
  saved = false,
  reset = false,
  technicians = [],
}: {
  task: TaskDetail;
  saved?: boolean;
  /** The task was just reset (`?reset=1`): shows the confirmation. */
  reset?: boolean;
  /** The technicians that "Terugzetten" offers; only needed for an Opgepikt task. */
  technicians?: readonly { id: string; fullName: string }[];
}) {
  const now = new Date();
  const number = formatTaskNumber(task.number);
  const editable = canEditTask(task.status);
  const estimate =
    task.estimatedMinutes !== null ? ` · geschatte duur ${formatHours(task.estimatedMinutes)}` : "";

  return (
    <>
      {saved ? <SavedNotice>{`Taak ${number} bewaard.`}</SavedNotice> : null}
      {reset && task.status === "assigned" && task.assignee ? (
        <SavedNotice param="reset">
          {RESET_MESSAGES.done(
            task.assignee.fullName,
            `${formatDate(task.scheduledDate, { omitCurrentYear: true, now })} om ${formatTimeOfDay(task.startTime)}`,
          )}
        </SavedNotice>
      ) : null}
      <Link href="/tasks" className="text-sm underline-offset-4 hover:underline">
        ← Taken
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="text-sm text-muted-foreground">Taak {number}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{task.customer.name}</h1>
          <p className="mt-1">
            <span className="font-medium">{workTypeLabel(task.workType)}</span> ·{" "}
            {formatDate(task.scheduledDate, { omitCurrentYear: true, now })} om{" "}
            {formatTimeOfDay(task.startTime)}
            {estimate}
            {task.assignee ? ` · ${task.assignee.fullName}` : ""}
          </p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              variant={task.status === "picked_up" ? "outline" : "default"}
              className="h-11 px-4 md:h-10"
            >
              <Link href={`/tasks/${task.number}/edit`}>Bewerken</Link>
            </Button>
            {task.status === "picked_up" ? (
              // The version in the key: after a reset the page has a new version and the dialog
              // starts closed again.
              <ResetTaskDialog
                key={task.version}
                taskNumber={task.number}
                version={task.version}
                technicians={technicians}
                currentAssigneeId={task.assignee?.id ?? null}
                scheduledDate={task.scheduledDate}
                startTime={formatTimeOfDay(task.startTime)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {task.status === "cancelled" && task.cancelledAt ? (
        <div className="mt-5 rounded-lg border border-slate-300 bg-slate-100 px-5 py-4 text-sm text-slate-800">
          <p className="font-medium">
            Deze taak is geannuleerd op {formatMoment(task.cancelledAt, now)}
            {task.cancelledByName ? ` door ${task.cancelledByName}` : ""}.
          </p>
          {task.cancellationReason ? (
            <p className="mt-1">Reden: {task.cancellationReason}</p>
          ) : null}
          <p className="mt-2 text-slate-700">
            Een geannuleerde taak kan je niet meer wijzigen. Moet het werk toch gebeuren?{" "}
            <Link href="/tasks/new" className="font-medium underline underline-offset-4">
              Maak een nieuwe taak aan
            </Link>
            .
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Completion task={task} now={now} />
          <Block id="heading-instructions" title="Instructies">
            <Multiline text={task.instructions} className="leading-relaxed" />
          </Block>
          <div className="grid gap-4 sm:grid-cols-2">
            <Block id="heading-location" title="Locatie">
              <p className="mt-2">
                {task.locationStreet}
                <br />
                {task.locationPostalCode} {task.locationCity}
              </p>
            </Block>
            <Block id="heading-customer" title="Klant">
              <p className="mt-2 font-medium">{task.customer.name}</p>
              {task.customer.phone ? (
                <p className="text-sm">
                  <a href={telHref(task.customer.phone)} className="underline underline-offset-4">
                    {task.customer.phone}
                  </a>
                </p>
              ) : null}
              {task.customer.notes ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Opmerking: {task.customer.notes}
                </p>
              ) : null}
            </Block>
          </div>
        </div>

        <aside className="space-y-4">
          <Block id="heading-technician" title="Technieker">
            {task.assignee ? (
              <p className="mt-2 font-medium">{task.assignee.fullName}</p>
            ) : (
              <>
                <p className="mt-2 text-muted-foreground italic">Nog niet toegewezen</p>
                {task.status === "open" ? (
                  <Link
                    href={`/tasks/${task.number}/edit`}
                    className="mt-2 inline-block text-sm underline underline-offset-4"
                  >
                    Technieker kiezen
                  </Link>
                ) : null}
              </>
            )}
          </Block>
          <Block id="heading-timeline" title="Tijdlijn">
            <Timeline items={buildTimeline(task, now)} />
          </Block>
        </aside>
      </div>
    </>
  );
}
