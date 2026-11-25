/**
 * Placeholder while the login page checks whether the visitor is already signed in. Looks
 * like the form but is not one: no fields, so nobody can type into it (and lose it again
 * when the real form replaces it).
 */
export function LoginFormSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mt-6 animate-pulse space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
    >
      <div className="h-11 rounded-md bg-muted" />
      <div className="h-11 rounded-md bg-muted" />
      <div className="h-11 rounded-md bg-muted" />
    </div>
  );
}
