import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Shown when `notFound()` is called for a customer page: an id that is not valid or does not
 * exist. It says the same for both, and it is only reached after the role check, so it tells
 * nobody whether a customer exists.
 */
export default function CustomerNotFound() {
  return (
    <div className="mx-auto w-full max-w-md py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Deze klant bestaat niet (meer).</h1>
      <p className="mt-2 text-muted-foreground">Ga terug naar de klantenlijst.</p>
      <Button asChild className="mt-4 h-11 px-4 md:h-10">
        <Link href="/customers">Naar de klanten</Link>
      </Button>
    </div>
  );
}
