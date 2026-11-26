/** The message under a wrong field (design chapter 3); the field points to it with `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1 text-sm font-medium text-red-700">
      {message}
    </p>
  ) : null;
}

/** The ids of the messages a field refers to (`aria-describedby`), or `undefined` when there are none. */
export function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const used = ids.filter(Boolean).join(" ");
  return used || undefined;
}
