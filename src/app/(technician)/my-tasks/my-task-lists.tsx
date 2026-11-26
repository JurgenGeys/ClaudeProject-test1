import type { ReactNode } from "react";

import type { MyDoneTask, MyOpenTask } from "@/lib/tasks/my-tasks";
import { groupMyTasks, type DayGroup } from "@/lib/tasks/my-tasks-groups";
import { formatDate } from "@/lib/time/format";

import { MyDoneItem, MyTaskCard } from "./my-task-card";

function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="mt-1 text-sm text-slate-600">{children}</p> : null}
    </div>
  );
}

function Section({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6" aria-labelledby={id}>
      <h2 id={id} className={`text-sm font-semibold tracking-wide uppercase ${className}`}>
        {title}
      </h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

/** `Vandaag · ma 23/11`, `Morgen · di 24/11`, or `wo 25/11` (with the year in another year). */
function dayHeading(group: DayGroup<MyOpenTask>, now: Date): string {
  const date = formatDate(group.dayKey, { omitCurrentYear: true, now });
  if (group.relative === "today") {
    return `Vandaag · ${date}`;
  }
  return group.relative === "tomorrow" ? `Morgen · ${date}` : date;
}

/**
 * The "Te doen" tab (design T1): Bezig on top (picked up tasks, orange), then Te laat (a
 * planned day before today, not finished), then one section per day. The tasks arrive sorted
 * on day and start time.
 */
export function TodoList({ tasks, now }: { tasks: MyOpenTask[]; now: Date }) {
  if (tasks.length === 0) {
    return (
      <EmptyState title="Je hebt geen taken.">
        Nieuwe taken verschijnen hier zodra kantoor ze aan jou toewijst.
      </EmptyState>
    );
  }
  const { busy, late, days } = groupMyTasks(tasks, now);
  return (
    <>
      {busy.length > 0 ? (
        <Section id="heading-busy" title="Bezig" className="text-amber-900">
          {busy.map((task) => (
            <MyTaskCard key={task.id} task={task} now={now} when="day" />
          ))}
        </Section>
      ) : null}
      {late.length > 0 ? (
        <Section id="heading-late" title="Te laat" className="text-red-700">
          {late.map((task) => (
            <MyTaskCard key={task.id} task={task} now={now} when="day" late />
          ))}
        </Section>
      ) : null}
      {days.map((group) => (
        <Section
          key={group.dayKey}
          id={`heading-day-${group.dayKey}`}
          title={dayHeading(group, now)}
          className="text-slate-600"
        >
          {group.tasks.map((task) => (
            <MyTaskCard key={task.id} task={task} now={now} when="time" />
          ))}
        </Section>
      ))}
    </>
  );
}

/** The "Afgewerkt" tab (design T1): what the technician finished in the last 30 days, newest first. */
export function DoneList({ tasks, now }: { tasks: MyDoneTask[]; now: Date }) {
  return (
    <>
      <p className="mt-4 text-sm text-slate-600">Je afgemelde taken van de laatste 30 dagen.</p>
      {tasks.length === 0 ? (
        <EmptyState title="Je hebt de laatste 30 dagen nog geen taken afgemeld." />
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
          {tasks.map((task) => (
            <MyDoneItem key={task.id} task={task} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}
