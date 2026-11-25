import { Suspense, type ReactNode } from "react";

import { GateFallback } from "@/components/auth/gate-fallback";
import { RoleGate } from "@/components/auth/role-gate";

/** Pages for technicians (design T1 to T3), meant for a phone: narrow layout. */
export default function TechnicianLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <Suspense fallback={<GateFallback />}>
        <RoleGate role="technician">{children}</RoleGate>
      </Suspense>
    </div>
  );
}
