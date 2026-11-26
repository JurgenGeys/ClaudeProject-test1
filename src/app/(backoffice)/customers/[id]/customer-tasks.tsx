import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import type { CustomerTaskRow } from "@/lib/customers/list";
import { formatTaskNumber, workTypeLabel } from "@/lib/tasks/labels";
import { formatDate } from "@/lib/time/format";

/** First non-empty line of the instructions: the short description in lists (design B2). */
function firstLine(instructions: string): string {
  return (
    instructions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/**
 * "Taken voor deze klant" (design B6): every task of the customer, cancelled ones included,
 * newest first. A row opens the task (B3).
 */
export function CustomerTasks({ tasks }: { tasks: CustomerTaskRow[] }) {
  return (
    <section className="mt-8" aria-labelledby="heading-customer-tasks">
      <h2 id="heading-customer-tasks" className="text-lg font-semibold">
        Taken voor deze klant
      </h2>
      {tasks.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-muted-foreground">
          Er zijn nog geen taken voor deze klant.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
          {tasks.map((task) => (
            <li key={task.number}>
              <Link
                href={`/tasks/${task.number}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatTaskNumber(task.number)}
                  </span>{" "}
                  <span className="font-medium">{formatDate(task.scheduledDate)}</span>
                  <span className="text-sm text-muted-foreground">
                    {" · "}
                    {workTypeLabel(task.workType)}
                    {" · "}
                    {task.technicianName ?? "Nog niet toegewezen"}
                    {firstLine(task.instructions) ? ` · ${firstLine(task.instructions)}` : ""}
                  </span>
                </span>
                <StatusBadge status={task.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
