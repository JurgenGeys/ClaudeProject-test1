"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldSummary } from "@/lib/validation/field-summary";

import { inviteTechnician, type TechnicianActionState } from "./actions";
import { useSetTechnicianNotice } from "./technician-notice";

/** "Technieker toevoegen": button plus dialog (design B7). */
export function AddTechnicianDialog() {
  const [open, setOpen] = useState(false);
  const setNotice = useSetTechnicianNotice();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-10 px-4">
          <Plus aria-hidden="true" />
          Technieker toevoegen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Technieker toevoegen</DialogTitle>
          <DialogDescription>
            De technieker krijgt een mail met een link om een wachtwoord te kiezen.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while the dialog is open, so every opening starts with an empty form. */}
        <AddTechnicianForm
          onInvited={(message) => {
            setOpen(false);
            setNotice({ kind: "success", message });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddTechnicianForm({ onInvited }: { onInvited: (message: string) => void }) {
  const [state, formAction, pending] = useActionState<TechnicianActionState, FormData>(
    async (previous, formData) => {
      const result = await inviteTechnician(previous, formData);
      if (result?.ok) {
        onInvited(result.message);
      }
      return result;
    },
    null,
  );
  const alertRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const failed = state && !state.ok ? state : null;
  const fieldErrors = failed?.fieldErrors ?? {};
  const errorCount = Object.keys(fieldErrors).length;
  const message = failed?.formError ?? (errorCount > 0 ? fieldSummary(errorCount) : undefined);

  // Tells the end-to-end tests that React is attached and the form is ready to be submitted.
  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  // After a refused attempt the focus goes to the message, so a screen reader reads it.
  useEffect(() => {
    if (failed && alertRef.current) {
      alertRef.current.focus();
    }
  }, [failed]);

  return (
    // `noValidate`: the browser would show its own (English) messages; the server validates.
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
        <Label htmlFor="technician-name" className="block">
          Naam <span aria-hidden="true">*</span>
        </Label>
        <Input
          id="technician-name"
          name="fullName"
          autoComplete="off"
          defaultValue={failed?.values?.fullName ?? ""}
          aria-invalid={fieldErrors.fullName ? true : undefined}
          aria-describedby={fieldErrors.fullName ? "technician-name-error" : undefined}
          className="mt-1 h-10"
        />
        {fieldErrors.fullName ? (
          <p id="technician-name-error" className="mt-1 text-sm font-medium text-red-700">
            {fieldErrors.fullName}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="technician-email" className="block">
          E-mailadres <span aria-hidden="true">*</span>
        </Label>
        <Input
          id="technician-email"
          name="email"
          type="email"
          autoComplete="off"
          inputMode="email"
          defaultValue={failed?.values?.email ?? ""}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "technician-email-error" : undefined}
          className="mt-1 h-10"
        />
        {fieldErrors.email ? (
          <p id="technician-email-error" className="mt-1 text-sm font-medium text-red-700">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-10 px-4">
            Annuleren
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending ? "Bezig met versturen…" : "Uitnodiging versturen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
