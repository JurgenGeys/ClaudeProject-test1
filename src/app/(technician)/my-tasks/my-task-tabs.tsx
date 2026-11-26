import Link from "next/link";

import { myTasksHref, type MyTasksTab } from "@/lib/validation/my-tasks";
import { cn } from "@/lib/utils";

const TABS: { tab: MyTasksTab; label: string }[] = [
  { tab: "todo", label: "Te doen" },
  { tab: "done", label: "Afgewerkt" },
];

/**
 * The tabs "Te doen" and "Afgewerkt" of T1. Links that change the address (`?tab=done`), so
 * Back works and the list is always the one of the address; the current one has
 * `aria-current`. Like the status tabs of B1: navigation, not ARIA `role="tab"`.
 * Every link is at least 44 px high.
 */
export function MyTaskTabs({ current }: { current: MyTasksTab }) {
  return (
    <nav
      aria-label="Mijn taken"
      className="mt-4 grid grid-cols-2 rounded-md bg-muted p-1 text-sm font-medium"
    >
      {TABS.map(({ tab, label }) => (
        <Link
          key={tab}
          href={myTasksHref(tab)}
          aria-current={tab === current ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center justify-center rounded px-3 text-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            tab === current
              ? "bg-background shadow-sm"
              : "text-foreground/80 hover:bg-background/60 hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
