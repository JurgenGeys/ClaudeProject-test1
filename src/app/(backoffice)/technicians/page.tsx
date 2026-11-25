import type { Metadata } from "next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { checkRoleAccess } from "@/lib/auth/role-access";
import { listTechnicians } from "@/lib/technicians/queries";
import { cn } from "@/lib/utils";

import { AddTechnicianDialog } from "./add-technician-dialog";
import { ResendInviteButton } from "./resend-invite-button";
import { TechnicianNoticeProvider } from "./technician-notice";
import { TechnicianStatusBadge } from "./technician-status-badge";

export const metadata: Metadata = { title: "Techniekers" };

/**
 * B7: the technicians, with "Technieker toevoegen" and "Uitnodiging opnieuw versturen".
 * Switching off and on again come in BT-07 and BT-07b.
 */
export default async function TechniciansPage() {
  // Every page checks the role itself (ADR-0002, rule 3); the layout only handles the display.
  const access = await checkRoleAccess("backoffice");
  if (access.kind !== "allowed") {
    return null; // The layout shows the "not for you" or "unavailable" message.
  }
  const technicians = await listTechnicians();

  return (
    <TechnicianNoticeProvider>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Techniekers</h1>
        <AddTechnicianDialog />
      </div>

      {technicians.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-lg font-medium">Er zijn nog geen techniekers.</p>
          <p className="mt-1 text-muted-foreground">
            Voeg je eerste technieker toe. Hij krijgt een mail om een wachtwoord te kiezen.
          </p>
          <div className="mt-4 flex justify-center">
            <AddTechnicianDialog />
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="text-xs tracking-wide text-muted-foreground uppercase">
                <TableHead scope="col">Naam</TableHead>
                <TableHead scope="col">E-mailadres</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="text-right">
                  Open taken
                </TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Acties</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {technicians.map((technician) => {
                const disabled = technician.status === "disabled";
                return (
                  <TableRow key={technician.id}>
                    <TableCell className={cn("font-medium", disabled && "text-muted-foreground")}>
                      {technician.fullName}
                    </TableCell>
                    <TableCell className={cn(disabled && "text-muted-foreground")}>
                      {technician.email}
                    </TableCell>
                    <TableCell>
                      <TechnicianStatusBadge status={technician.status} />
                    </TableCell>
                    <TableCell className={cn("text-right", disabled && "text-muted-foreground")}>
                      {technician.openTasks}
                    </TableCell>
                    <TableCell className="text-right">
                      {technician.status === "invited" ? (
                        <ResendInviteButton technicianId={technician.id} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </TechnicianNoticeProvider>
  );
}
