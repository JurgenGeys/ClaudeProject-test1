import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SavedNotice } from "@/components/saved-notice";
import { Button } from "@/components/ui/button";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { getCustomerDetail } from "@/lib/customers/list";
import { CUSTOMER_ACTION_MESSAGES } from "@/lib/customers/messages";
import { parseCustomerId } from "@/lib/validation/customer-list";

import { CustomerForm } from "../customer-form";

import { CustomerTasks } from "./customer-tasks";

export const metadata: Metadata = { title: "Klant" };

/**
 * B6 in edit mode (`/customers/<id>`): the customer, the form and, below, the tasks of the
 * customer. The role is checked first, so nobody else learns whether a customer exists; an id
 * that is not valid and an id that does not exist give the same "not found" page.
 */
export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const id = parseCustomerId((await params).id);
  const customer = id === null ? null : await getCustomerDetail(id);
  if (!customer) {
    notFound();
  }
  const { saved } = await searchParams;
  const { tasks, ...fields } = customer;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {saved === "1" ? <SavedNotice>{CUSTOMER_ACTION_MESSAGES.saved}</SavedNotice> : null}
      <Link href="/customers" className="text-sm underline-offset-4 hover:underline">
        ← Klanten
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
        <Button asChild variant="outline" className="h-11 px-4 md:h-10">
          <Link href={`/tasks/new?customer=${customer.id}`}>
            <span aria-hidden="true">+ </span>Nieuwe taak voor deze klant
          </Link>
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Velden met <span className="text-red-700">*</span> zijn verplicht.
      </p>
      {/* A new key when the saved data changes: the fields then show what was saved (trimmed). */}
      <CustomerForm key={JSON.stringify(fields)} customer={fields} />
      <CustomerTasks tasks={tasks} />
    </div>
  );
}
