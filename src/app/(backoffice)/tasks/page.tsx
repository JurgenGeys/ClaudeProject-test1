import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";

export const metadata: Metadata = { title: "Taken" };

/** The task number in `?saved=1051` (set by `createTask`): digits only, so nothing else is shown. */
function savedTaskNumber(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) {
    return null;
  }
  return Number(value);
}

/**
 * Start page of the backoffice (B1). The task overview itself is built in BT-09; for now it has
 * the "Nieuwe taak" button and the confirmation after saving a task ("Taak #1051 bewaard.").
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  // The lookup is cached per request, so this costs nothing extra.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const saved = savedTaskNumber((await searchParams).saved);

  return (
    <>
      {saved ? (
        <Alert
          role="status"
          className="mb-4 border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
        >
          <AlertDescription>{TASK_ACTION_MESSAGES.saved(saved)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Taken</h1>
        <Button asChild className="h-10 px-4">
          <Link href="/tasks/new">
            <Plus aria-hidden="true" />
            Nieuwe taak
          </Link>
        </Button>
      </div>
    </>
  );
}
