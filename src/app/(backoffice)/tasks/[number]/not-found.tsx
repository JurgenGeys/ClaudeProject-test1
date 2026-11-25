import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Shown when `notFound()` is called for a task page: a task number that is not valid or does
 * not exist. It says the same for both, and it is only reached after the role check, so it
 * tells nobody whether a task exists (design B3, "Lege toestand").
 */
export default function TaskNotFound() {
  return (
    <div className="mx-auto w-full max-w-md py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Deze taak bestaat niet (meer).</h1>
      <p className="mt-2 text-muted-foreground">
        Controleer het taaknummer, of ga terug naar het overzicht.
      </p>
      <Button asChild className="mt-4 h-11 px-4 md:h-10">
        <Link href="/tasks">Naar de taken</Link>
      </Button>
    </div>
  );
}
