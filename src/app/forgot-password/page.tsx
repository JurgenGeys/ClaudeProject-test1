import type { Metadata } from "next";
import { Suspense } from "react";

import { getCompanyName } from "@/lib/company";

import { LoginFormSkeleton } from "../login/login-form-skeleton";
import { ForgotPasswordContent } from "./forgot-password-content";

export const metadata: Metadata = { title: "Wachtwoord vergeten", robots: { index: false } };

/** G3 Wachtwoord vergeten: ask for a link to choose a new password. */
export default function ForgotPasswordPage() {
  const companyName = getCompanyName();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {companyName ? (
          <p className="text-center text-sm font-medium text-muted-foreground">{companyName}</p>
        ) : null}
        <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
          Wachtwoord vergeten
        </h1>
        {/* The session is request data, so the form streams in behind a boundary. */}
        <Suspense fallback={<LoginFormSkeleton />}>
          <ForgotPasswordContent />
        </Suspense>
      </div>
    </main>
  );
}
