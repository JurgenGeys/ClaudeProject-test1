"use client";

import { useActionState, useEffect, useRef } from "react";

import { login } from "./actions";

const inputClass =
  "mt-1 block h-11 w-full rounded-md border border-border bg-background px-3 text-base " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-[invalid=true]:border-red-700";

/** "Vul de 2 gemarkeerde velden in." (design: summary above the form). */
function fieldSummary(count: number): string {
  return count === 1 ? "Vul het gemarkeerde veld in." : `Vul de ${count} gemarkeerde velden in.`;
}

/**
 * The login form (design G1). `notice` is a message that was decided before the form was
 * shown, for example "account uitgeschakeld" after a deactivated user was signed out.
 */
export function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState(login, null);
  const alertRef = useRef<HTMLDivElement>(null);

  const fieldErrors = state?.fieldErrors ?? {};
  const errorCount = Object.keys(fieldErrors).length;
  const message =
    state?.formError ?? (errorCount > 0 ? fieldSummary(errorCount) : (notice ?? undefined));

  // After a failed attempt the focus goes to the message, so a screen reader reads it
  // and a keyboard user can tab on to the first field.
  useEffect(() => {
    if (state && alertRef.current) {
      alertRef.current.focus();
    }
  }, [state]);

  return (
    // `noValidate`: the browser would show its own (English) messages; the server validates.
    <form
      action={formAction}
      noValidate
      className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
    >
      {message ? (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {message}
        </div>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          E-mailadres
        </label>
        <input
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
        <label htmlFor="password" className="block text-sm font-medium">
          Wachtwoord
        </label>
        <input
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

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-md bg-primary text-base font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending ? "Bezig met aanmelden…" : "Aanmelden"}
      </button>
    </form>
  );
}
