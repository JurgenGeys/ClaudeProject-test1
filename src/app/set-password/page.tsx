import type { Metadata } from "next";
import { Suspense } from "react";

import { getCompanyName } from "@/lib/company";

import { LoginFormSkeleton } from "../login/login-form-skeleton";
import { SetPasswordContent } from "./set-password-content";

export const metadata: Metadata = { title: "Wachtwoord instellen", robots: { index: false } };

/** G2 Wachtwoord instellen (mode invite): where the link in the invitation mail ends. */
export default function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const companyName = getCompanyName();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {companyName ? (
          <p className="text-center text-sm font-medium text-muted-foreground">{companyName}</p>
        ) : null}
        {/* The session and the query string are request data, so the content streams in
            behind a boundary. The fallback is no form, so nobody can type into it. */}
        <Suspense fallback={<LoginFormSkeleton />}>
          <SetPasswordContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
