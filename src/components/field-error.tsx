/** The message under a wrong field (design chapter 3); the field points to it with `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1 text-sm font-medium text-red-700">
      {message}
    </p>
  ) : null;
}
