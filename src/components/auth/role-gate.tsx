import type { ReactNode } from "react";

import type { UserRole } from "@/db/schema";
import { checkRoleAccess } from "@/lib/auth/role-access";

import { NotForYou } from "./not-for-you";
import { SignOutButton } from "./sign-out-button";

/**
 * Wraps a route group: only an active user with the given role sees `children`. It reads
 * the session, so a layout must render it inside `<Suspense>` (Cache Components).
 *
 * The bar with the name and "Uitloggen" is a minimal placeholder; BT-04 replaces it with
 * the real AppHeader per role. Pages must still authorize their own data access: a layout
 * is not rendered again when navigating between pages of the same group.
 */
export async function RoleGate({ role, children }: { role: UserRole; children: ReactNode }) {
  const access = await checkRoleAccess(role);
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
