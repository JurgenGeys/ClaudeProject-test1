import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { MainNav, type NavItem } from "@/components/main-nav";
import type { UserRole } from "@/db/schema";
import { homePathForRole } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

/**
 * Main menu of the backoffice (design chapter 2). The customer and technician pages are
 * built in later tasks (BT-18 and BT-06); until then these links lead to the standard 404 page.
 */
export const BACKOFFICE_NAV: readonly NavItem[] = [
  { href: "/tasks", label: "Taken" },
  { href: "/customers", label: "Klanten" },
  { href: "/technicians", label: "Techniekers" },
];

/** Shown when `NEXT_PUBLIC_COMPANY_NAME` is empty. */
const FALLBACK_NAME = "Planning";

/**
 * Header of every signed-in page (design chapter 2 and the mockups).
 * - technician (phone first): company name, own name and "Uitloggen"; no menu;
 * - backoffice (laptop first): company name, the main menu, own name and "Uitloggen". On a
 *   narrow screen the menu moves to a second line.
 */
export function AppHeader({
  role,
  userName,
  companyName,
}: {
  role: UserRole;
  userName: string;
  /** Name of the client's company; empty or missing shows the plain word "Planning". */
  companyName?: string;
}) {
  const isBackoffice = role === "backoffice";
  return (
    <header className="border-b border-border bg-background">
      <div
        className={cn(
          "mx-auto flex w-full items-center gap-x-6 gap-y-1 px-4",
          isBackoffice ? "max-w-6xl flex-wrap py-1 sm:px-6" : "max-w-md min-h-14 justify-between",
        )}
      >
        <Link
          href={homePathForRole(role)}
          className="min-w-0 truncate rounded-md font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {companyName || FALLBACK_NAME}
        </Link>
        {isBackoffice ? <MainNav items={BACKOFFICE_NAV} /> : null}
        <div className={cn("flex items-center gap-2 text-sm", isBackoffice && "ml-auto")}>
          <span className="text-muted-foreground">{userName}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
