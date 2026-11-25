"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { resendInvite, type TechnicianActionState } from "./actions";
import { useSetTechnicianNotice } from "./technician-notice";

/** "Uitnodiging opnieuw versturen" for a technician who has not chosen a password yet (design B7). */
export function ResendInviteButton({ technicianId }: { technicianId: string }) {
  const setNotice = useSetTechnicianNotice();
  const [, formAction, pending] = useActionState<TechnicianActionState, FormData>(
    async (previous, formData) => {
      const result = await resendInvite(previous, formData);
      if (result?.ok) {
        setNotice({ kind: "success", message: result.message });
      } else if (result) {
        setNotice({ kind: "error", message: result.formError ?? "" });
      }
      return result;
    },
    null,
  );

  return (
    <form action={formAction} className="flex justify-end">
      <input type="hidden" name="id" value={technicianId} />
      <Button type="submit" variant="outline" disabled={pending} className="h-9">
        {pending ? "Bezig met versturen…" : "Uitnodiging opnieuw versturen"}
      </Button>
    </form>
  );
}
