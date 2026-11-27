"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportFilename } from "@/lib/export/csv";
import { EXPORT_MESSAGES as M } from "@/lib/export/messages";
import { taskOverviewHref } from "@/lib/validation/task-overview";
import type { ExportProblem, ExportScope } from "@/lib/validation/export";

type Done = { count: number; filename: string; from: string; to: string };

const DOWNLOAD_PATH = "/tasks/export/download";

/**
 * The form of B4. It is a plain GET form to the download route, so it works without script (the
 * browser downloads the file, and a problem comes back as `?problem=` on this page). With script
 * the file is fetched, saved, and the message "Het bestand met 12 taken is gedownload" is shown
 * with the link to the tab Afgewerkt. The server decides everything; this only transports it.
 */
export function ExportForm({
  initial,
  problem,
}: {
  initial: { from: string; to: string; scope: ExportScope };
  problem: ExportProblem | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [failed, setFailed] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Tells the end-to-end tests that the script is active (like the other forms).
  // Moves the focus to the message once it is on the screen, so it is read out.
  useEffect(() => {
    if (done) {
      noticeRef.current?.focus();
    }
  }, [done]);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of ["from", "to", "scope"]) {
      const value = form.get(key);
      if (typeof value === "string") query.set(key, value);
    }
    setPending(true);
    setDone(null);
    setFailed(false);
    try {
      const response = await fetch(`${DOWNLOAD_PATH}?${query.toString()}`, {
        credentials: "same-origin",
      });
      if (response.redirected) {
        // The route sent us on: back to this page with `?problem=` (a problem with the request),
        // or to the login page (the session ran out). Follow it, on this site only.
        const target = new URL(response.url);
        if (target.origin === window.location.origin) {
          router.push(`${target.pathname}${target.search}`);
          return;
        }
        setFailed(true);
        return;
      }
      if (response.status === 401 || response.status === 403) {
        router.refresh();
        return;
      }
      const count = Number(response.headers.get("X-Export-Count"));
      if (!response.ok || !Number.isSafeInteger(count) || count < 1) {
        setFailed(true);
        return;
      }
      const from = String(query.get("from"));
      const to = String(query.get("to"));
      const filename = exportFilename(from, to);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDone({ count, filename, from, to });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const fieldProblem = problem === "missing" || problem === "reversed" || problem === "toolong";
  const fieldMessage =
    problem === "missing" ? M.missing : problem === "reversed" ? M.reversed : M.tooLong;
  const describedBy = fieldProblem ? "export-period-hint export-problem" : "export-period-hint";
  return (
    <form
      method="get"
      action={DOWNLOAD_PATH}
      onSubmit={onSubmit}
      noValidate
      aria-label="Exporteren"
      data-hydrated={hydrated ? "true" : undefined}
      className="mt-6 grid gap-6"
    >
      {problem === "empty" ? (
        <Alert>
          <AlertDescription>
            <p className="font-medium text-foreground">{M.empty(initial.from, initial.to)}</p>
            <p>{M.emptyAdvice}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>{M.failed}</AlertDescription>
        </Alert>
      ) : null}
      {done ? (
        <div ref={noticeRef} tabIndex={-1} role="status" className="outline-none">
          <Alert
            role="presentation"
            className="border-green-200 bg-green-50 text-green-900 *:data-[slot=alert-description]:text-green-900"
          >
            <AlertDescription>
              <p>{M.downloaded(done.count, done.filename)}</p>
              <Link
                href={taskOverviewHref({ tab: "completed", from: done.from, to: done.to })}
                className="font-medium underline underline-offset-4"
              >
                {M.toCompleted}
              </Link>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">
          {M.period}{" "}
          <span className="text-red-700" aria-hidden="true">
            *
          </span>
        </legend>
        <p id="export-period-hint" className="text-sm text-muted-foreground">
          {M.periodHint}
        </p>
        <div className="flex flex-wrap gap-4">
          <div className="grid gap-1">
            <Label htmlFor="export-from">{M.from}</Label>
            <Input
              id="export-from"
              name="from"
              type="date"
              required
              defaultValue={initial.from}
              aria-invalid={problem === "missing" && !initial.from ? true : undefined}
              aria-describedby={describedBy}
              className="h-11 w-auto md:h-10"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="export-to">{M.to}</Label>
            <Input
              id="export-to"
              name="to"
              type="date"
              required
              defaultValue={initial.to}
              aria-invalid={
                fieldProblem && (problem !== "missing" || !initial.to) ? true : undefined
              }
              aria-describedby={describedBy}
              className="h-11 w-auto md:h-10"
            />
          </div>
        </div>
        {fieldProblem ? (
          <p id="export-problem" role="alert" className="text-sm font-medium text-red-700">
            {fieldMessage}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{M.scope}</legend>
        {problem === "scope" ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {M.scopeProblem}
          </p>
        ) : null}
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="radio"
            name="scope"
            value="completed"
            defaultChecked={initial.scope === "completed"}
            className="mt-1 size-5"
          />
          <span>
            {M.scopeCompleted}
            <span className="block text-sm text-muted-foreground">{M.scopeCompletedHint}</span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="radio"
            name="scope"
            value="all"
            defaultChecked={initial.scope === "all"}
            className="mt-1 size-5"
          />
          <span>
            {M.scopeAll}
            <span className="block text-sm text-muted-foreground">{M.scopeAllHint}</span>
          </span>
        </label>
      </fieldset>

      <div>
        <Button
          type="submit"
          disabled={pending}
          aria-disabled={pending}
          className="h-11 px-6 md:h-10"
        >
          {pending ? M.downloading : M.download}
        </Button>
      </div>
    </form>
  );
}
