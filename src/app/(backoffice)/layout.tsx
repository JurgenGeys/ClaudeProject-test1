import { Suspense, type ReactNode } from "react";

import { GateFallback } from "@/components/auth/gate-fallback";
import { RoleGate } from "@/components/auth/role-gate";

/** Pages for backoffice and the managing director (design B1 to B7), meant for a laptop. */
export default function BackofficeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-1 flex-col">
      <Suspense fallback={<GateFallback />}>
        <RoleGate role="backoffice">{children}</RoleGate>
      </Suspense>
    </div>
  );
}
