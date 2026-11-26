import type { Metadata } from "next";
import Link from "next/link";

import { checkRoleAccess } from "@/lib/auth/role-access";
import { getCustomerForNewTask } from "@/lib/customers/lookup";
import { listAssignableTechnicians } from "@/lib/technicians/queries";

import { TaskForm } from "../task-form";

export const metadata: Metadata = { title: "Nieuwe taak" };

/**
 * B2 in create mode: the form for a new task (BT-08). Editing a task is `[number]/edit`.
 * `?customer=<id>` ("Nieuwe taak voor deze klant" in B6, BT-18) starts with that customer chosen
 * and the location filled in with his address.
 */
export default async function NewTaskPage({ searchParams }: PageProps<"/tasks/new">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const [technicians, customer] = await Promise.all([
    listAssignableTechnicians(),
    getCustomerForNewTask((await searchParams).customer),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/tasks" className="text-sm underline-offset-4 hover:underline">
        ← Taken
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nieuwe taak</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Velden met <span className="text-red-700">*</span> zijn verplicht.
      </p>
      <TaskForm technicians={technicians} customer={customer ?? undefined} />
    </div>
  );
}
