import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pagina niet gevonden" };

/**
 * The page for every address that does not exist (also the menu items whose pages come in
 * later tasks). It does not read the session, so it works for signed-out visitors too. `/`
 * sends a signed-in user to the start page of the role and a visitor to the login page.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Deze pagina bestaat (nog) niet</h1>
      <p className="text-muted-foreground">
        Controleer het adres, of ga terug naar de startpagina.
      </p>
      <div>
        <Button asChild size="lg" className="h-11 px-4 text-base font-semibold">
          <Link href="/">Naar de startpagina</Link>
        </Button>
      </div>
    </main>
  );
}
