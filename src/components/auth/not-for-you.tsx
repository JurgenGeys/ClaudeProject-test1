import Link from "next/link";

import type { UserRole } from "@/db/schema";
import { Button } from "@/components/ui/button";
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
      <Button asChild size="lg" className="h-11 px-4 text-base font-semibold">
        <Link href={homePathForRole(role)}>{HOME_LABELS[role]}</Link>
      </Button>
    </section>
  );
}
