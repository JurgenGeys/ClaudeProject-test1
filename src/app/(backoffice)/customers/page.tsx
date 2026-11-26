import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { getCustomerList } from "@/lib/customers/list";
import { CUSTOMER_SEARCH_MAX_LENGTH } from "@/lib/customers/limits";
import { CUSTOMER_ACTION_MESSAGES } from "@/lib/customers/messages";

import { CustomerList } from "./customer-list";
import { CustomerPagination } from "./customer-pagination";

export const metadata: Metadata = { title: "Klanten" };

/**
 * B5: the customers with a search field (name, city or phone number; all in the URL as `?q=`)
 * and, per customer, the number of tasks and the day of the latest one. The search is a plain
 * GET form, so it works without any script.
 */
export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const { params, rows, total, pageCount, hasAnyCustomer } = await getCustomerList(
    await searchParams,
  );

  const newCustomerButton = (
    <Button asChild className="h-11 px-4 md:h-10">
      <Link href="/customers/new">
        <Plus aria-hidden="true" />
        Nieuwe klant
      </Link>
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Klanten</h1>
        {/* With no customers at all the button is in the empty state, so there is one link, not two. */}
        {hasAnyCustomer ? newCustomerButton : null}
      </div>

      {!hasAnyCustomer ? (
        <div className="mt-8 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-lg font-medium">Er zijn nog geen klanten.</p>
          <p className="mt-1 text-muted-foreground">
            Klanten worden ook automatisch toegevoegd als je een taak voor een nieuwe klant
            aanmaakt.
          </p>
          <div className="mt-4 flex justify-center">{newCustomerButton}</div>
        </div>
      ) : (
        <>
          <form
            // The field only takes `defaultValue` when it is created; a new key makes React
            // create it again when the search text changes (Back button, "Alle klanten").
            key={params.q}
            method="get"
            action="/customers"
            role="search"
            aria-label="Klanten zoeken"
            className="mt-5 flex max-w-xl flex-wrap items-end gap-3"
          >
            <div className="grid min-w-56 flex-1 gap-1">
              <Label htmlFor="customer-filter">Zoeken</Label>
              <Input
                id="customer-filter"
                type="search"
                name="q"
                defaultValue={params.q}
                maxLength={CUSTOMER_SEARCH_MAX_LENGTH}
                autoComplete="off"
                placeholder="Naam, gemeente of telefoon"
                className="h-11 md:h-10"
              />
            </div>
            <Button type="submit" variant="outline" className="h-11 px-4 md:h-10">
              Zoeken
            </Button>
          </form>

          {rows.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
              <p className="font-medium">{CUSTOMER_ACTION_MESSAGES.noneFound(params.q)}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button asChild variant="outline" className="h-11 px-4 md:h-10">
                  <Link href="/customers">Alle klanten tonen</Link>
                </Button>
                <Button asChild variant="outline" className="h-11 px-4 md:h-10">
                  <Link href="/customers/new">Nieuwe klant aanmaken</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <CustomerList rows={rows} />
              <CustomerPagination params={params} pageCount={pageCount} total={total} />
            </>
          )}
        </>
      )}
    </>
  );
}
