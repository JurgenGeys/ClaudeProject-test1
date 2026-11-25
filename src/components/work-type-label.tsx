import { workTypeLabel } from "@/lib/tasks/labels";
import type { WorkType } from "@/lib/tasks/types";

/** The kind of work as plain text: Nazicht, Onderhoud or Herstelling (design proposal P6). */
export function WorkTypeLabel({ workType, className }: { workType: WorkType; className?: string }) {
  return (
    <span data-work-type={workType} className={className}>
      {workTypeLabel(workType)}
    </span>
  );
}
