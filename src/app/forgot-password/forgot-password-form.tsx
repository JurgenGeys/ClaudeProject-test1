"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FORGOT_PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { LOGIN_PATH } from "@/lib/auth/routes";

import { requestPasswordReset } from "./actions";

// 44 px high, as the design asks for touch targets on a phone.
const inputClass = "mt-1 h-11";

const backLink = (
  <p className="mt-4 text-center text-sm">
    <Link href={LOGIN_PATH} className="underline underline-offset-4">
      Terug naar aanmelden
    </Link>
  </p>
);

/** The form of G3 and, after sending, the one confirmation that every address gets. */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, null);
  const alertRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const emailError = state && !state.sent ? state.fieldErrors.email : undefined;

  // Tells the end-to-end tests that React is attached and the form is ready to be submitted.
  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  // After a refused attempt the focus goes to the message, so a screen reader reads it.
  useEffect(() => {
    if (emailError && alertRef.current) {
      alertRef.current.focus();
    }
  }, [emailError]);

  if (state?.sent) {
    return (
      <>
        <div
          role="status"
          className="mt-6 rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900"
        >
          {FORGOT_PASSWORD_MESSAGES.sent}
        </div>
        {backLink}
      </>
    );
  }

  return (
    <>
      <Card className="mt-6 py-0 shadow-sm">
        <CardContent className="p-6">
          {/* `noValidate`: the browser would show its own (English) messages; the server validates. */}
          <form ref={formRef} action={formAction} noValidate className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vul je e-mailadres in. Je krijgt een mail met een link om een nieuw wachtwoord te
              kiezen.
            </p>
            {emailError ? (
              <Alert
                ref={alertRef}
                variant="destructive"
                tabIndex={-1}
                className="border-red-200 bg-red-50 text-red-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 *:data-[slot=alert-description]:text-red-900"
              >
                <AlertDescription>{emailError}</AlertDescription>
              </Alert>
            ) : null}
            <div>
              <Label htmlFor="email" className="block">
                E-mailadres
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                defaultValue={state && !state.sent ? state.email : ""}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "email-error" : undefined}
                className={inputClass}
              />
              {emailError ? (
                <p id="email-error" className="mt-1 text-sm text-red-700">
                  {emailError}
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={pending}
              className="h-11 w-full text-base font-semibold"
            >
              {pending ? "Bezig met versturen…" : "Stuur mij een link"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {backLink}
    </>
  );
}
