"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOMER_ACTION_MESSAGES } from "@/lib/customers/messages";
import type { CustomerFormField } from "@/lib/validation/customer-form";

import { createCustomer, updateCustomer, type CustomerFormState } from "./actions";

/** The customer as saved, when an existing customer is edited. Without it the form makes a new one. */
export type CustomerFormEdit = {
  id: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

function Required() {
  return (
    <span aria-hidden="true" className="text-red-700">
      *
    </span>
  );
}

/**
 * The form of "Nieuwe klant" and "Klant bewerken" (design B6). The server validates everything;
 * the form only shows what came back: a summary with the focus, and a message under every wrong
 * field. Sent by hand (`onSubmit`) like the task form: a refused form must keep what was typed,
 * and the button is disabled until React has taken over the page.
 */
export function CustomerForm({ customer }: { customer?: CustomerFormEdit }) {
  const [state, dispatch, pending] = useActionState<CustomerFormState, FormData>(
    customer ? updateCustomer : createCustomer,
    null,
  );
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const alertRef = useRef<HTMLDivElement>(null);

  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};
  const errorCount = Object.keys(errors).length;
  const summary =
    failed?.formError ??
    (errorCount > 0 ? CUSTOMER_ACTION_MESSAGES.notSaved(errorCount) : undefined);

  // After a refused attempt the focus goes to the summary, so a screen reader reads it.
  useEffect(() => {
    if (failed && alertRef.current) {
      alertRef.current.focus();
    }
  }, [failed]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  /** `aria-invalid` and `aria-describedby` of a field, for its message `<field>-error`. */
  function invalid(field: CustomerFormField, ...extra: string[]) {
    const ids = [...extra, ...(errors[field] ? [`customer-${field}-error`] : [])];
    return {
      "aria-invalid": errors[field] ? (true as const) : undefined,
      "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
    };
  }

  return (
    // `noValidate`: the browser would show its own (English) messages; the server validates.
    <form
      onSubmit={submit}
      noValidate
      data-hydrated={hydrated ? "true" : undefined}
      className="mt-6 rounded-lg border border-border bg-card p-5"
    >
      {summary ? (
        <Alert
          ref={alertRef}
          variant="destructive"
          tabIndex={-1}
          className="mb-4 border-red-200 bg-red-50 text-red-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 *:data-[slot=alert-description]:text-red-900"
        >
          <AlertDescription>{summary}</AlertDescription>
        </Alert>
      ) : null}

      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_1fr]">
        <div className="sm:col-span-3">
          <Label htmlFor="customer-name" className="block">
            Naam <Required />
          </Label>
          <Input
            id="customer-name"
            name="name"
            defaultValue={customer?.name}
            aria-required="true"
            autoComplete="off"
            {...invalid("name")}
            className="mt-1 h-10"
          />
          <FieldError id="customer-name-error" message={errors.name} />
        </div>

        <div className="sm:col-span-3">
          <Label htmlFor="customer-street" className="block">
            Straat en nummer
          </Label>
          <Input
            id="customer-street"
            name="street"
            defaultValue={customer?.street ?? ""}
            autoComplete="off"
            {...invalid("street")}
            className="mt-1 h-10"
          />
          <FieldError id="customer-street-error" message={errors.street} />
        </div>

        <div>
          <Label htmlFor="customer-postalCode" className="block">
            Postcode
          </Label>
          <Input
            id="customer-postalCode"
            name="postalCode"
            defaultValue={customer?.postalCode ?? ""}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            {...invalid("postalCode")}
            className="mt-1 h-10"
          />
          <FieldError id="customer-postalCode-error" message={errors.postalCode} />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="customer-city" className="block">
            Gemeente
          </Label>
          <Input
            id="customer-city"
            name="city"
            defaultValue={customer?.city ?? ""}
            autoComplete="off"
            {...invalid("city")}
            className="mt-1 h-10"
          />
          <FieldError id="customer-city-error" message={errors.city} />
        </div>

        <div>
          <Label htmlFor="customer-phone" className="block">
            Telefoon
          </Label>
          <Input
            id="customer-phone"
            name="phone"
            type="tel"
            defaultValue={customer?.phone ?? ""}
            autoComplete="off"
            {...invalid("phone")}
            className="mt-1 h-10"
          />
          <FieldError id="customer-phone-error" message={errors.phone} />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="customer-email" className="block">
            E-mail
          </Label>
          <Input
            id="customer-email"
            name="email"
            type="email"
            defaultValue={customer?.email ?? ""}
            autoComplete="off"
            {...invalid("email")}
            className="mt-1 h-10"
          />
          <FieldError id="customer-email-error" message={errors.email} />
        </div>

        <div className="sm:col-span-3">
          <Label htmlFor="customer-notes" className="block">
            Opmerkingen
          </Label>
          <Textarea
            id="customer-notes"
            name="notes"
            defaultValue={customer?.notes ?? ""}
            rows={2}
            {...invalid("notes", "customer-notes-hint")}
            className="mt-1"
          />
          <p id="customer-notes-hint" className="mt-1 text-xs text-muted-foreground">
            De technieker ziet deze opmerking bij elke taak voor deze klant.
          </p>
          <FieldError id="customer-notes-error" message={errors.notes} />
        </div>
      </div>

      {customer ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Een adreswijziging hier past de locatie van bestaande taken niet aan.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !hydrated} className="h-10 px-5">
          {pending ? "Bezig met bewaren…" : "Klant bewaren"}
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link href="/customers">Annuleren</Link>
        </Button>
      </div>
    </form>
  );
}
