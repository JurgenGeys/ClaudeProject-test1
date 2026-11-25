import type { Metadata } from "next";

import { checkRoleAccess } from "@/lib/auth/role-access";

export const metadata: Metadata = { title: "Mijn taken" };

/** Start page of the technician (T1). The task list itself is built in BT-11. */
export default async function MyTasksPage() {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  // The lookup is cached per request, so this costs nothing extra.
  const access = await checkRoleAccess("technician");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  return <h1 className="text-2xl font-semibold tracking-tight">Mijn taken</h1>;
}
