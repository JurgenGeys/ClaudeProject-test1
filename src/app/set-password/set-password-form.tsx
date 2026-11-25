"use client";

import { useActionState, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/password";
import { fieldSummary } from "@/lib/validation/field-summary";

import { setPassword } from "./actions";

// 44 px high, as the design asks for touch targets on a phone.
const inputClass = "mt-1 h-11";

/** The form of G2: "Nieuw wachtwoord", "Herhaal wachtwoord" and "Wachtwoord bewaren". */
export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, null);
  const alertRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const fieldErrors = state?.fieldErrors ?? {};
  const errorCount = Object.keys(fieldErrors).length;
  const message = state?.formError ?? (errorCount > 0 ? fieldSummary(errorCount) : undefined);

  // Tells the end-to-end tests that React is attached and the form is ready to be submitted.
  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  // After a refused attempt the focus goes to the message, so a screen reader reads it.
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
            <Label htmlFor="password" className="block">
              Nieuw wachtwoord
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={
                fieldErrors.password ? "password-hint password-error" : "password-hint"
              }
              className={inputClass}
            />
            <p id="password-hint" className="mt-1 text-xs text-muted-foreground">
              Minstens {PASSWORD_MIN_LENGTH} tekens.
            </p>
            {fieldErrors.password ? (
              <p id="password-error" className="mt-1 text-sm font-medium text-red-700">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="confirm-password" className="block">
              Herhaal wachtwoord
            </Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={fieldErrors.confirmPassword ? true : undefined}
              aria-describedby={fieldErrors.confirmPassword ? "confirm-password-error" : undefined}
              className={inputClass}
            />
            {fieldErrors.confirmPassword ? (
              <p id="confirm-password-error" className="mt-1 text-sm font-medium text-red-700">
                {fieldErrors.confirmPassword}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={pending} className="h-11 w-full text-base font-semibold">
            {pending ? "Bezig met bewaren…" : "Wachtwoord bewaren"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
