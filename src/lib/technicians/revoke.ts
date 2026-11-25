import "server-only";

import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { profiles, recoverySessions } from "@/db/schema";

/** What `revokeInvitationProfile` did, or why it refused. */
export type RevokeOutcome =
  | { kind: "revoked"; fullName: string }
  /** No profile with this id, or it is not a technician. */
  | { kind: "not-found" }
  /** The technician chose a password in the meantime (or was never invited): nothing to revoke. */
  | { kind: "not-pending"; fullName: string }
  /** Something refers to this profile. Cannot happen for a real invitation; checked anyway. */
  | { kind: "has-records"; fullName: string };

/** The part of a Drizzle transaction that is needed here. */
export type RevokeTransaction = Pick<Database, "select" | "delete" | "execute">;

/**
 * Removes the profile of a technician who has not accepted the invitation yet (design B7,
 * "Uitnodiging intrekken"). Must run inside a transaction that the caller commits.
 *
 * The profile row is locked with `FOR UPDATE` first, like switching off. Then, while the lock is
 * held, it refuses anything but a technician with `invite_pending = true`, and refuses when any
 * row refers to the profile (every foreign key to `profiles` is `ON DELETE RESTRICT`, so this
 * would fail anyway; the explicit check gives a clear answer instead of a database error). A task
 * cannot be assigned to an invited technician (BT-08), so this should never happen.
 *
 * Only the temporary sessions of a "wachtwoord vergeten" link (`recovery_sessions`) are removed
 * with the profile: they are session bookkeeping, not business data.
 */
export async function revokeInvitationProfile(
  tx: RevokeTransaction,
  technicianId: string,
): Promise<RevokeOutcome> {
  const [profile] = await tx
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      invitePending: profiles.invitePending,
    })
    .from(profiles)
    .where(eq(profiles.id, technicianId))
    .for("update");

  if (!profile || profile.role !== "technician") {
    return { kind: "not-found" };
  }
  if (!profile.invitePending) {
    return { kind: "not-pending", fullName: profile.fullName };
  }

  const [references] = await tx.execute<{ found: boolean }>(sql`
    select (
      exists (select 1 from public.customers where created_by = ${profile.id})
      or exists (
        select 1 from public.tasks
        where assignee_id = ${profile.id} or invoiced_by = ${profile.id}
          or cancelled_by = ${profile.id} or created_by = ${profile.id}
          or updated_by = ${profile.id}
      )
      or exists (
        select 1 from public.task_completions
        where completed_by = ${profile.id} or corrected_by = ${profile.id}
      )
    ) as found
  `);
  if (references?.found) {
    return { kind: "has-records", fullName: profile.fullName };
  }

  await tx.delete(recoverySessions).where(eq(recoverySessions.userId, profile.id));
  await tx.delete(profiles).where(eq(profiles.id, profile.id));
  return { kind: "revoked", fullName: profile.fullName };
}
