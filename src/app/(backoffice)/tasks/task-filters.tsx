import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { FilterTechnician } from "@/lib/tasks/overview";
import {
  DEFAULT_OVERVIEW_TAB,
  hasExtraFilters,
  taskOverviewHref,
  type TaskOverviewFilters,
} from "@/lib/validation/task-overview";

/**
 * The filters of B1: technician and period (on the planned day). A plain GET form, so it works
 * through the URL without any script: "Filteren" opens `/tasks?technician=...&from=...`. The
 * status tab travels along as a hidden field.
 */
export function TaskFilters({
  filters,
  technicians,
}: {
  filters: TaskOverviewFilters;
  technicians: FilterTechnician[];
}) {
  return (
    <form
      method="get"
      action="/tasks"
      aria-label="Filters"
      className="mt-4 flex flex-wrap items-end gap-3"
    >
      {filters.tab !== DEFAULT_OVERVIEW_TAB ? (
        <input type="hidden" name="status" value={filters.tab} />
      ) : null}
      <div className="grid gap-1">
        <Label htmlFor="filter-technician" className="text-xs">
          Technieker
        </Label>
        <NativeSelect
          id="filter-technician"
          name="technician"
          defaultValue={filters.technician ?? ""}
          className="h-11 w-auto md:h-10"
        >
          <option value="">Alle techniekers</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.isActive ? technician.fullName : `${technician.fullName} (uitgeschakeld)`}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="filter-from" className="text-xs">
          Van
        </Label>
        <Input
          id="filter-from"
          name="from"
          type="date"
          defaultValue={filters.from ?? ""}
          className="h-11 w-auto md:h-10"
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="filter-to" className="text-xs">
          Tot en met
        </Label>
        <Input
          id="filter-to"
          name="to"
          type="date"
          defaultValue={filters.to ?? ""}
          className="h-11 w-auto md:h-10"
        />
      </div>
      <Button type="submit" variant="outline" className="h-11 px-4 md:h-10">
        Filteren
      </Button>
      {hasExtraFilters(filters) ? (
        <Link
          href={taskOverviewHref({ tab: filters.tab })}
          className="inline-flex h-11 items-center px-2 text-sm underline underline-offset-4 md:h-10"
        >
          Filters wissen
        </Link>
      ) : null}
    </form>
  );
}
