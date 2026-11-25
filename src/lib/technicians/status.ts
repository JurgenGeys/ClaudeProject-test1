/**
 * The three states of a technician in the list (design B7). They follow from two fields of the
 * profile; there is no column for them, so the two can never disagree.
 * - `active`: may sign in.
 * - `invited`: got an invitation and has not chosen a password yet (`invite_pending`).
 * - `disabled`: switched off (`is_active = false`), whatever else is true. Switching off
 *   itself is `deactivateTechnician` (BT-07), switching on again `reactivateTechnician` (BT-07b).
 */
export const technicianStatuses = ["active", "invited", "disabled"] as const;
export type TechnicianStatus = (typeof technicianStatuses)[number];

export function technicianStatus(profile: {
  isActive: boolean;
  invitePending: boolean;
}): TechnicianStatus {
  if (!profile.isActive) {
    return "disabled";
  }
  return profile.invitePending ? "invited" : "active";
}

const LABELS: Record<TechnicianStatus, string> = {
  active: "Actief",
  invited: "Uitgenodigd",
  disabled: "Uitgeschakeld",
};

export function technicianStatusLabel(status: TechnicianStatus): string {
  return LABELS[status];
}

/**
 * Order in the list: active and invited technicians first, switched-off ones at the bottom
 * (as in the mockup), each group by name. Returns a new array.
 */
export function sortTechnicians<T extends { fullName: string; status: TechnicianStatus }>(
  technicians: readonly T[],
): T[] {
  return [...technicians].sort((a, b) => {
    const disabled = Number(a.status === "disabled") - Number(b.status === "disabled");
    return disabled || a.fullName.localeCompare(b.fullName, "nl-BE", { sensitivity: "base" });
  });
}
