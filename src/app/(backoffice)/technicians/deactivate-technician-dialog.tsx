"use client";

import Link from "next/link";
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
import { TECHNICIAN_ACTION_MESSAGES } from "@/lib/technicians/messages";

import { deactivateTechnician, type TechnicianActionState } from "./actions";
import { useSetTechnicianNotice } from "./technician-notice";

type Props = {
  technicianId: string;
  fullName: string;
  /** Open tasks as the list counted them (Toegewezen + Opgepikt). */
  openTasks: number;
};

/**
 * "Uitschakelen" for an active technician (design B7). With open tasks the button leads to the
 * dialog "Uitschakelen kan nog niet" (as in the mockup); without, to the confirmation. The
 * server checks the open tasks again whatever this screen showed: when someone got a task in
 * the meantime, the refusal dialog replaces the confirmation with the real count.
 */
export function DeactivateTechnicianDialog({ technicianId, fullName, openTasks }: Props) {
  const [open, setOpen] = useState(false);
  // The count that the server refused with, when it differs from what the list showed.
  const [refusedCount, setRefusedCount] = useState<number | null>(null);
  const setNotice = useSetTechnicianNotice();
  const blockingTasks = refusedCount ?? openTasks;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRefusedCount(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-9">
          Uitschakelen
        </Button>
      </DialogTrigger>
      {/* The refusal has its own "Sluiten" button: no corner cross, or there are two of them. */}
      <DialogContent className="sm:max-w-md" showCloseButton={blockingTasks === 0}>
        {blockingTasks > 0 ? (
          <>
            <DialogHeader>
              <DialogTitle>Uitschakelen kan nog niet</DialogTitle>
              <DialogDescription>
                {TECHNICIAN_ACTION_MESSAGES.hasOpenTasks(fullName, blockingTasks)}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" className="h-10 px-4">
                  Sluiten
                </Button>
              </DialogClose>
              <Button asChild className="h-10 px-4">
                <Link href={`/tasks?technician=${encodeURIComponent(technicianId)}`}>
                  Toon zijn taken
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <ConfirmForm
            technicianId={technicianId}
            fullName={fullName}
            onDone={(message) => {
              setOpen(false);
              setNotice({ kind: "success", message });
            }}
            onOpenTasks={setRefusedCount}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmForm({
  technicianId,
  fullName,
  onDone,
  onOpenTasks,
}: {
  technicianId: string;
  fullName: string;
  onDone: (message: string) => void;
  onOpenTasks: (count: number) => void;
}) {
  const [state, formAction, pending] = useActionState<TechnicianActionState, FormData>(
    async (previous, formData) => {
      const result = await deactivateTechnician(previous, formData);
      if (result?.ok) {
        onDone(result.message);
      } else if (result?.openTasks) {
        onOpenTasks(result.openTasks);
      }
      return result;
    },
    null,
  );
  const failed = state && !state.ok && !state.openTasks ? state : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={technicianId} />
      <DialogHeader>
        <DialogTitle>{fullName} uitschakelen?</DialogTitle>
        <DialogDescription>
          Hij kan zich dan niet meer aanmelden. Zijn afgewerkte taken en uren blijven bewaard.
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
          {pending ? "Bezig met uitschakelen…" : "Uitschakelen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
