import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Shown when `notFound()` is called for a task of a technician: a number that is not valid, a
 * task that does not exist and a task that is not his. It says the same for all of them, and it
 * is only reached after the role check, so it tells nobody whether a task exists (design T2,
 * "Rechten").
 */
export default function MyTaskNotFound() {
  return (
    <div className="py-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        Deze taak bestaat niet of is niet aan jou toegewezen.
      </h1>
      <p className="mt-2 text-muted-foreground">
        Controleer het taaknummer, of ga terug naar je lijst.
      </p>
      <Button asChild className="mt-4 h-11 px-4">
        <Link href="/my-tasks">Naar mijn taken</Link>
      </Button>
    </div>
  );
}
