"use client";

import { useEffect, useRef, useState } from "react";

import { FieldError } from "@/components/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CUSTOMER_SEARCH_MIN_LENGTH } from "@/lib/customers/limits";
import type { CustomerSearchResult } from "@/lib/customers/search";
import { TASK_ACTION_MESSAGES } from "@/lib/tasks/messages";
import type { CreateTaskFieldErrors } from "@/lib/validation/create-task";

import { searchCustomers } from "../../customers/actions";

const SEARCH_DELAY_MS = 250;

/** One line under a result or the chosen customer: address and phone as far as they are known. */
function customerLine(customer: CustomerSearchResult): string {
  const place = [customer.postalCode, customer.city].filter(Boolean).join(" ");
  return [[customer.street, place].filter(Boolean).join(", "), customer.phone]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Block 1 of the task form (design B2): look up a customer by name, phone number or city, or
 * add a new one. It sends `customerMode` (`existing` or `new`) and, for an existing customer,
 * `customerId`; the fields of a new customer are named `newCustomer…`. Choosing a customer
 * calls `onChoose`, so the form can fill in the location with the address of the customer.
 *
 * The three states stay mounted and are only hidden, so what was typed is not lost when
 * somebody switches to a new customer and back.
 */
export function CustomerPicker({
  errors,
  onChoose,
}: {
  errors: CreateTaskFieldErrors;
  onChoose: (customer: CustomerSearchResult) => void;
}) {
  const [chosen, setChosen] = useState<CustomerSearchResult | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CustomerSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Answers can arrive in another order than the questions: only the latest counts.
  const latest = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  function changeTerm(value: string) {
    setTerm(value);
    clearTimeout(timer.current);
    latest.current += 1;
    const text = value.trim();
    setSearchError(null);
    if (text.length < CUSTOMER_SEARCH_MIN_LENGTH) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ticket = latest.current;
    timer.current = setTimeout(async () => {
      let answer: Awaited<ReturnType<typeof searchCustomers>>;
      try {
        answer = await searchCustomers(text);
      } catch {
        answer = { ok: false, message: TASK_ACTION_MESSAGES.searchFailed };
      }
      if (ticket !== latest.current) {
        return;
      }
      setSearching(false);
      setSearchError(answer.ok ? null : answer.message);
      setResults(answer.ok ? answer.customers : null);
    }, SEARCH_DELAY_MS);
  }

  function choose(customer: CustomerSearchResult) {
    setChosen(customer);
    setIsNew(false);
    changeTerm("");
    onChoose(customer);
  }

  function chooseAnother() {
    setChosen(null);
    changeTerm("");
    // The search field is shown again by this state change; focus it once it is visible.
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function startNew() {
    setIsNew(true);
    setChosen(null);
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  function stopNew() {
    setIsNew(false);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  const searchVisible = !chosen && !isNew;
  const text = term.trim();
  const status = searching
    ? "Zoeken…"
    : searchError
      ? searchError
      : results === null
        ? ""
        : results.length === 0
          ? TASK_ACTION_MESSAGES.noCustomerFound(text)
          : results.length === 1
            ? "1 klant gevonden."
            : `${results.length} klanten gevonden.`;

  return (
    <div className="mt-3">
      <input type="hidden" name="customerMode" value={isNew ? "new" : "existing"} />
      <input type="hidden" name="customerId" value={chosen?.id ?? ""} />

      <div hidden={!searchVisible}>
        <Label htmlFor="customer-search" className="block">
          Zoek een klant
        </Label>
        <Input
          ref={searchRef}
          id="customer-search"
          type="search"
          autoComplete="off"
          placeholder="Naam, gemeente of telefoon"
          value={term}
          onChange={(event) => changeTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              const first = resultsRef.current?.querySelector("button");
              if (first) {
                event.preventDefault();
                first.focus();
              }
            }
          }}
          aria-required="true"
          aria-invalid={errors.customerId && searchVisible ? true : undefined}
          aria-describedby={
            [errors.customerId ? "customer-error" : "", "customer-search-status"]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className="mt-1 h-10"
        />
        <FieldError id="customer-error" message={searchVisible ? errors.customerId : undefined} />
        <p
          id="customer-search-status"
          role="status"
          className="mt-1 text-sm text-muted-foreground empty:hidden"
        >
          {status}
        </p>
        {results && results.length > 0 ? (
          <ul
            ref={resultsRef}
            aria-label="Gevonden klanten"
            className="mt-1 divide-y divide-border rounded-md border border-border bg-card shadow-sm"
          >
            {results.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => choose(customer)}
                  className="w-full px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="font-medium">{customer.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {customerLine(customer)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button type="button" variant="outline" className="mt-3 h-10 px-4" onClick={startNew}>
          + Nieuwe klant
        </Button>
      </div>

      {chosen ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-muted/50 p-4">
          <div>
            <p className="font-medium">{chosen.name}</p>
            <p className="text-sm text-muted-foreground">{customerLine(chosen)}</p>
          </div>
          <Button type="button" variant="link" className="h-auto p-0" onClick={chooseAnother}>
            Andere klant kiezen
          </Button>
          <FieldError id="customer-error" message={errors.customerId} />
        </div>
      ) : null}

      <div hidden={!isNew} className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Nieuwe klant. Het adres vul je hieronder in bij &quot;Locatie&quot;.
        </p>
        <div className="sm:col-span-2">
          <Label htmlFor="new-customer-name" className="block">
            Naam{" "}
            <span aria-hidden="true" className="text-red-700">
              *
            </span>
          </Label>
          <Input
            ref={nameRef}
            id="new-customer-name"
            name="newCustomerName"
            autoComplete="off"
            aria-required="true"
            aria-invalid={errors.newCustomerName ? true : undefined}
            aria-describedby={errors.newCustomerName ? "new-customer-name-error" : undefined}
            className="mt-1 h-10"
          />
          <FieldError id="new-customer-name-error" message={errors.newCustomerName} />
        </div>
        <div>
          <Label htmlFor="new-customer-phone" className="block">
            Telefoon
          </Label>
          <Input
            id="new-customer-phone"
            name="newCustomerPhone"
            type="tel"
            autoComplete="off"
            aria-invalid={errors.newCustomerPhone ? true : undefined}
            aria-describedby={errors.newCustomerPhone ? "new-customer-phone-error" : undefined}
            className="mt-1 h-10"
          />
          <FieldError id="new-customer-phone-error" message={errors.newCustomerPhone} />
        </div>
        <div>
          <Label htmlFor="new-customer-email" className="block">
            E-mail
          </Label>
          <Input
            id="new-customer-email"
            name="newCustomerEmail"
            type="email"
            autoComplete="off"
            aria-invalid={errors.newCustomerEmail ? true : undefined}
            aria-describedby={errors.newCustomerEmail ? "new-customer-email-error" : undefined}
            className="mt-1 h-10"
          />
          <FieldError id="new-customer-email-error" message={errors.newCustomerEmail} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="new-customer-notes" className="block">
            Opmerkingen
          </Label>
          <Input
            id="new-customer-notes"
            name="newCustomerNotes"
            autoComplete="off"
            placeholder="Bv. sleutel bij de buren"
            aria-invalid={errors.newCustomerNotes ? true : undefined}
            aria-describedby={errors.newCustomerNotes ? "new-customer-notes-error" : undefined}
            className="mt-1 h-10"
          />
          <FieldError id="new-customer-notes-error" message={errors.newCustomerNotes} />
        </div>
        <div className="sm:col-span-2">
          <Button type="button" variant="link" className="h-auto p-0" onClick={stopNew}>
            Toch een bestaande klant zoeken
          </Button>
        </div>
      </div>
    </div>
  );
}
