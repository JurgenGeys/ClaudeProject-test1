import Link from "next/link";

import type { UserRole } from "@/db/schema";
import { homePathForRole } from "@/lib/auth/routes";

const HOME_LABELS: Record<UserRole, string> = {
  technician: "Naar mijn taken",
  backoffice: "Naar de taken",
};

/** Shown when someone opens a page of the other role (design chapter 2). */
export function NotForYou({ role }: { role: UserRole }) {
  return (
    <section className="space-y-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        Deze pagina is niet voor jou bedoeld
      </h1>
      <p className="text-muted-foreground">
        Met je account kan je deze pagina niet openen. Ga terug naar je eigen startpagina.
      </p>
      <Link
        href={homePathForRole(role)}
        className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {HOME_LABELS[role]}
      </Link>
    </section>
  );
}
