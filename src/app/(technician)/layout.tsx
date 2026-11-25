import { Suspense, type ReactNode } from "react";

import { GateFallback } from "@/components/auth/gate-fallback";
import { RoleGate } from "@/components/auth/role-gate";

/** Pages for technicians (design T1 to T3), meant for a phone: the gate gives a narrow layout. */
export default function TechnicianLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-1 flex-col">
      <Suspense fallback={<GateFallback />}>
        <RoleGate role="technician">{children}</RoleGate>
      </Suspense>
    </div>
  );
}
