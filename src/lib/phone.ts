/** A `tel:` address for a phone number as people write it (`014 41 22 87`, `+32 14 41 22 87`). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
