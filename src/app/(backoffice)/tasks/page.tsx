import type { Metadata } from "next";

import { checkRoleAccess } from "@/lib/auth/role-access";

export const metadata: Metadata = { title: "Taken" };

/** Start page of the backoffice (B1). The task overview itself is built in BT-09. */
export default async function TasksPage() {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  // The lookup is cached per request, so this costs nothing extra.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  return <h1 className="text-2xl font-semibold tracking-tight">Taken</h1>;
}
