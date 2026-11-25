/** The first word of a full name, for a greeting ("Welkom, Kevin"). Falls back to the whole name. */
export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}
