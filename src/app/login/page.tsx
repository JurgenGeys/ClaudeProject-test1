import type { Metadata } from "next";
import { Suspense } from "react";

import { getCompanyName } from "@/lib/company";

import { LoginContent } from "./login-content";
import { LoginFormSkeleton } from "./login-form-skeleton";

export const metadata: Metadata = { title: "Aanmelden" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  const companyName = getCompanyName();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {companyName ? (
          <p className="text-center text-sm font-medium text-muted-foreground">{companyName}</p>
        ) : null}
        <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
          Aanmelden bij de planning
        </h1>
        {/* The query string and the session are request data, so the form streams in behind a
            boundary. The fallback is no form, so there is never a second fillable form. */}
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
