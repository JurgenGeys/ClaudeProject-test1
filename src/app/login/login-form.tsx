"use client";

import { useActionState, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldSummary } from "@/lib/validation/field-summary";

import { login } from "./actions";

// 44 px high, as the design asks for touch targets on a phone.
const inputClass = "mt-1 h-11";

/**
 * The login form (design G1). `notice` is a message that was decided before the form was
 * shown, for example "account uitgeschakeld" after a deactivated user was signed out.
 */
export function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState(login, null);
  const alertRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const fieldErrors = state?.fieldErrors ?? {};
  const errorCount = Object.keys(fieldErrors).length;
  const message =
    state?.formError ?? (errorCount > 0 ? fieldSummary(errorCount) : (notice ?? undefined));

  // Tells the end-to-end tests that React is attached and the form is ready to be submitted.
  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  // After a failed attempt the focus goes to the message, so a screen reader reads it
  // and a keyboard user can tab on to the first field.
  useEffect(() => {
    if (state && alertRef.current) {
      alertRef.current.focus();
    }
  }, [state]);

  return (
    <Card className="mt-6 py-0 shadow-sm">
      <CardContent className="p-6">
        {/* `noValidate`: the browser would show its own (English) messages; the server validates. */}
        <form ref={formRef} action={formAction} noValidate className="space-y-4">
          {message ? (
            <Alert
              ref={alertRef}
              variant="destructive"
              tabIndex={-1}
              className="border-red-200 bg-red-50 text-red-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 *:data-[slot=alert-description]:text-red-900"
            >
              <AlertDescription>{message}</AlertDescription>
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
              defaultValue={state?.email ?? ""}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              className={inputClass}
            />
            {fieldErrors.email ? (
              <p id="email-error" className="mt-1 text-sm text-red-700">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="password" className="block">
              Wachtwoord
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className={inputClass}
            />
            {fieldErrors.password ? (
              <p id="password-error" className="mt-1 text-sm text-red-700">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={pending} className="h-11 w-full text-base font-semibold">
            {pending ? "Bezig met aanmelden…" : "Aanmelden"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
