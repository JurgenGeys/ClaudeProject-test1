import { Suspense } from "react";

import { GateFallback } from "@/components/auth/gate-fallback";

import { RoleRedirect } from "./role-redirect";

/** `/` has no content of its own: it reads the session (request data) and redirects. */
export default function Home() {
  return (
    <Suspense fallback={<GateFallback />}>
      <RoleRedirect />
    </Suspense>
  );
}
