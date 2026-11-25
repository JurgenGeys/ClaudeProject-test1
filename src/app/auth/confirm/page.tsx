import type { Metadata } from "next";
import { Suspense } from "react";

import { getCompanyName } from "@/lib/company";

import { LoginFormSkeleton } from "../../login/login-form-skeleton";
import { ConfirmContent } from "./confirm-content";

// The address holds a one-time token: no search engines, and no referrer to anywhere else.
export const metadata: Metadata = {
  title: "Wachtwoord instellen",
  robots: { index: false },
  referrer: "no-referrer",
};

/** Where the link in the invitation mail ends (design chapter 6, `/auth/confirm`). */
export default function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const companyName = getCompanyName();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {companyName ? (
          <p className="text-center text-sm font-medium text-muted-foreground">{companyName}</p>
        ) : null}
        <Suspense fallback={<LoginFormSkeleton />}>
          <ConfirmContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
