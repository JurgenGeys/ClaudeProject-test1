/**
 * Name of the client's company, shown above the title of the login screen. Set per client in
 * `NEXT_PUBLIC_COMPANY_NAME`. It is shown in the browser, so it is not a secret. Empty or not
 * set means: show no name (not an error). Next.js only inlines `NEXT_PUBLIC_*` variables that
 * are written out literally, so it must be read exactly like this.
 */
export function getCompanyName(): string | undefined {
  return process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || undefined;
}
