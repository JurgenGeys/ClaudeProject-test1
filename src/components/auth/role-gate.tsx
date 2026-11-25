import type { ReactNode } from "react";

import type { UserRole } from "@/db/schema";
import { checkRoleAccess } from "@/lib/auth/role-access";

import { AuthUnavailable } from "./auth-unavailable";
import { NotForYou } from "./not-for-you";
import { SignOutButton } from "./sign-out-button";

/**
 * Wraps a route group: only an active user with the given role sees `children`. It reads
 * the session, so a layout must render it inside `<Suspense>` (Cache Components).
 *
 * This only decides what is shown around the page. It is not the protection of the page: a
 * layout is not rendered again when navigating inside the group and does not stop the page's
 * own rendering. Every page, Server Action, route handler and read function checks the role
 * itself (ADR-0002, rule 3). The bar with the name and "Uitloggen" is a placeholder for
 * the AppHeader of BT-04.
 */
export async function RoleGate({ role, children }: { role: UserRole; children: ReactNode }) {
  const access = await checkRoleAccess(role);
  if (access.kind === "unavailable") {
    return <AuthUnavailable />;
  }
  const { user } = access;

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-1">
        <p className="text-sm font-medium">{user.fullName}</p>
        <SignOutButton />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {access.kind === "allowed" ? children : <NotForYou role={user.role} />}
      </main>
    </>
  );
}
