import { STATUS_CLASSES } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { technicianStatusLabel, type TechnicianStatus } from "@/lib/technicians/status";
import { cn } from "@/lib/utils";

/**
 * Same colors as the task statuses (green, blue, grey; contrast checked in `contrast.test.ts`).
 * The state is always written out as well, so color is never the only signal.
 */
const CLASSES: Record<TechnicianStatus, string> = {
  active: STATUS_CLASSES.completed,
  invited: STATUS_CLASSES.assigned,
  disabled: STATUS_CLASSES.open,
};

export function TechnicianStatusBadge({ status }: { status: TechnicianStatus }) {
  return (
    <Badge
      data-status={status}
      className={cn("rounded-full border-transparent px-2.5", CLASSES[status])}
    >
      {technicianStatusLabel(status)}
    </Badge>
  );
}
