"use client";

import { useActionState, useState } from "react";

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
import { LOGIN_MESSAGES } from "@/lib/auth/messages";

import { revokeInvitation, type TechnicianActionState } from "./actions";
import { useSetTechnicianNotice } from "./technician-notice";

type Props = {
  technicianId: string;
  fullName: string;
};

/** "Uitnodiging intrekken" for an invited technician: button and confirmation dialog (design B7). */
export function RevokeInvitationDialog({ technicianId, fullName }: Props) {
  const [open, setOpen] = useState(false);
  const setNotice = useSetTechnicianNotice();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-9">
          Uitnodiging intrekken
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <ConfirmForm
          technicianId={technicianId}
          fullName={fullName}
          onDone={(message) => {
            setOpen(false);
            setNotice({ kind: "success", message });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmForm({
  technicianId,
  fullName,
  onDone,
}: {
  technicianId: string;
  fullName: string;
  onDone: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState<TechnicianActionState, FormData>(
    async (previous, formData) => {
      const result = await revokeInvitation(previous, formData);
      if (result?.ok) {
        onDone(result.message);
      }
      return result;
    },
    null,
  );
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={technicianId} />
      <DialogHeader>
        <DialogTitle>De uitnodiging van {fullName} intrekken?</DialogTitle>
        <DialogDescription>
          De link in de mail werkt dan niet meer en hij verdwijnt uit de lijst. Je kan hem later
          opnieuw uitnodigen.
        </DialogDescription>
      </DialogHeader>
      {failed ? (
        <Alert
          variant="destructive"
          className="border-red-200 bg-red-50 text-red-900 *:data-[slot=alert-description]:text-red-900"
        >
          <AlertDescription>{failed.formError || LOGIN_MESSAGES.technicalProblem}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-10 px-4">
            Annuleren
          </Button>
        </DialogClose>
        <Button
          type="submit"
          disabled={pending}
          className="h-10 bg-red-700 px-4 text-white hover:bg-red-800"
        >
          {pending ? "Bezig met intrekken…" : "Uitnodiging intrekken"}
        </Button>
      </DialogFooter>
    </form>
  );
}
