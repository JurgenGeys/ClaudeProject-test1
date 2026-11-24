import type { Metadata } from "next";
import { Suspense } from "react";

import { LOGIN_MESSAGES } from "@/lib/auth/messages";
import { LOGIN_REASON_DISABLED } from "@/lib/auth/routes";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Aanmelden" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Aanmelden bij de planning
        </h1>
        {/* The query string is request data, so only the notice waits for it: the form itself is
            part of the static shell. */}
        <Suspense fallback={<LoginForm />}>
          <LoginFormWithNotice searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginFormWithNotice({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { reason } = await searchParams;
  return (
    <LoginForm
      notice={reason === LOGIN_REASON_DISABLED ? LOGIN_MESSAGES.accountDisabled : undefined}
    />
  );
}
