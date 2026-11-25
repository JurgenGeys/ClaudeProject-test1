import { Badge } from "@/components/ui/badge";
import { taskStatusLabel } from "@/lib/tasks/labels";
import type { TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/**
 * Colors per status (design chapter 3 and the mockups). The status is always also written
 * out, so color is never the only way to tell the statuses apart. Contrast of text on
 * background is at least 6.5 : 1 for every pair (WCAG AA asks for 4.5 : 1).
 */
const STATUS_CLASSES: Record<TaskStatus, string> = {
  open: "bg-slate-100 text-slate-700",
  assigned: "bg-blue-100 text-blue-800",
  picked_up: "bg-amber-100 text-amber-900",
  completed: "bg-green-100 text-green-800",
  invoiced: "bg-violet-100 text-violet-800",
  cancelled: "bg-red-100 text-red-800",
};

/** The status of a task as a colored label: Open, Toegewezen, Opgepikt, Afgewerkt, Gefactureerd or Geannuleerd. */
export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge
      data-status={status}
      className={cn("rounded-full border-transparent px-2.5", STATUS_CLASSES[status], className)}
    >
      {taskStatusLabel(status)}
    </Badge>
  );
}
