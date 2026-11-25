import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import type { UserRole } from "@/db/schema";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { getCompanyName } from "@/lib/company";
import { cn } from "@/lib/utils";

import { AuthUnavailable } from "./auth-unavailable";
import { NotForYou } from "./not-for-you";

/**
 * Wraps a route group: only an active user with the given role sees `children`. It reads
 * the session, so a layout must render it inside `<Suspense>` (Cache Components).
 *
 * This only decides what is shown around the page. It is not the protection of the page: a
 * layout is not rendered again when navigating inside the group and does not stop the page's
 * own rendering. Every page, Server Action, route handler and read function checks the role
 * itself (ADR-0002, rule 3).
 *
 * The header and the width of the page follow the role of the signed-in user, not the role
 * the page is meant for: a technician on a backoffice URL sees the technician header.
 */
export async function RoleGate({ role, children }: { role: UserRole; children: ReactNode }) {
  const access = await checkRoleAccess(role);
  if (access.kind === "unavailable") {
    return <AuthUnavailable />;
  }
  const { user } = access;

  return (
    <>
      <AppHeader role={user.role} userName={user.fullName} companyName={getCompanyName()} />
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 py-6",
          user.role === "technician" ? "max-w-md" : "max-w-6xl sm:px-6",
        )}
      >
        {access.kind === "allowed" ? children : <NotForYou role={user.role} />}
      </main>
    </>
  );
}
