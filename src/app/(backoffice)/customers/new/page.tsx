import type { Metadata } from "next";
import Link from "next/link";

import { checkRoleAccess } from "@/lib/auth/role-access";

import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Nieuwe klant" };

/** B6 in create mode: the form for a new customer (BT-18). */
export default async function NewCustomerPage() {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/customers" className="text-sm underline-offset-4 hover:underline">
        ← Klanten
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nieuwe klant</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Velden met <span className="text-red-700">*</span> zijn verplicht.
      </p>
      <CustomerForm />
    </div>
  );
}
