import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested against a real database in
// `src/db/complete-task.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const completeTaskInTransaction = vi.fn();
vi.mock("@/lib/tasks/complete", () => ({
  completeTaskInTransaction: (...args: unknown[]) => completeTaskInTransaction(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthError } from "@/lib/auth/session";

import { completeTask } from "./actions";

const VERSION = "2026-11-25T18:44:00.123456Z";
const kevin = { id: "k1", email: "k@x.be", fullName: "Kevin Wouters", role: "technician" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}
const valid = (extra: Record<string, string> = {}) =>
  form({
    taskNumber: "1042",
    version: VERSION,
    workedMinutes: "90",
    notes: "Filter vervangen",
    ...extra,
  });

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(kevin);
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  completeTaskInTransaction.mockResolvedValue({
    kind: "completed",
    id: "t1",
    number: 1042,
    completedAt: new Date("2026-11-26T09:00:00Z"),
  });
});

describe("completeTask: access", () => {
  it("checks the role first and refuses without touching the database", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const result = await completeTask(null, valid());
    expect(requireRole).toHaveBeenCalledWith("technician");
    expect(result).toMatchObject({ ok: false, kind: "error" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("says that the account is switched off for an inactive session", async () => {
    requireRole.mockRejectedValue(new AuthError("inactive"));
    expect(await completeTask(null, valid())).toEqual({
      ok: false,
      kind: "error",
      message: "Je account is uitgeschakeld. Neem contact op met kantoor.",
    });
  });
});

describe("completeTask: validation", () => {
  it("asks for hours with the sentence of the design, and does not open a transaction", async () => {
    const result = await completeTask(null, valid({ workedMinutes: "0" }));
    expect(result).toEqual({
      ok: false,
      kind: "fields",
      message: "Vul de gewerkte uren in om af te melden.",
      fieldErrors: { workedMinutes: "Vul de gewerkte uren in. Dat moet minstens 0u15 zijn." },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses minutes that are no quarter, more than 16u00 and notes over 2000 characters", async () => {
    expect(await completeTask(null, valid({ workedMinutes: "20" }))).toMatchObject({
      kind: "fields",
      message: "Vul het gemarkeerde veld in.",
      fieldErrors: { workedMinutes: "Vul de gewerkte uren in per kwartier, bv. 1u30." },
    });
    expect(await completeTask(null, valid({ workedMinutes: "975" }))).toMatchObject({
      fieldErrors: { workedMinutes: "De gewerkte uren mogen niet meer zijn dan 16u00." },
    });
    expect(await completeTask(null, valid({ notes: "x".repeat(2001) }))).toMatchObject({
      fieldErrors: { notes: "Je notitie is te lang. Houd het korter dan 2000 tekens." },
    });
    expect(
      await completeTask(null, valid({ workedMinutes: "0", notes: "x".repeat(2001) })),
    ).toMatchObject({ message: "Vul de 2 gemarkeerde velden in." });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("answers a form that this page never makes like a changed task", async () => {
    expect(await completeTask(null, form({ workedMinutes: "60" }))).toMatchObject({
      ok: false,
      kind: "changed",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("completeTask: the transaction", () => {
  it("passes the technician of the session and only the known fields, then redirects", async () => {
    await expect(
      completeTask(
        null,
        valid({ assigneeId: "someone-else", status: "invoiced", completedAt: "2020-01-01" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/my-tasks?completed=1");
    expect(completeTaskInTransaction).toHaveBeenCalledWith(tx, {
      actor: { id: "k1", role: "technician", isActive: true },
      number: 1042,
      version: VERSION,
      workedMinutes: 90,
      notes: "Filter vervangen",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/my-tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1042");
  });

  it("stores empty notes as null", async () => {
    await expect(completeTask(null, valid({ notes: "  " }))).rejects.toThrow("NEXT_REDIRECT");
    expect(completeTaskInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ notes: null }),
    );
  });

  it("confirms a double completion silently: the same redirect", async () => {
    completeTaskInTransaction.mockResolvedValue({ kind: "already-completed" });
    await expect(completeTask(null, valid())).rejects.toThrow(
      "NEXT_REDIRECT:/my-tasks?completed=1",
    );
  });

  it.each([
    ["not-assigned", "not-assigned", "Deze taak is niet meer aan jou toegewezen."],
    ["changed", "changed", "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw."],
    [
      "cancelled",
      "cancelled",
      "Deze taak is geannuleerd door kantoor. Je hoeft niets meer te doen.",
    ],
    ["inactive", "error", "Je account is uitgeschakeld. Neem contact op met kantoor."],
  ])("maps the outcome %s to the message of the design", async (outcome, kind, message) => {
    completeTaskInTransaction.mockResolvedValue({ kind: outcome });
    expect(await completeTask(null, valid())).toEqual({ ok: false, kind, message });
  });

  it("logs only the reason of an unexpected refusal, nothing personal", async () => {
    completeTaskInTransaction.mockResolvedValue({ kind: "refused", reason: "wrong_role" });
    expect(await completeTask(null, valid())).toMatchObject({ ok: false, kind: "error" });
    expect(consoleError).toHaveBeenCalledWith("Completing a task was refused:", "wrong_role");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("Filter vervangen");
  });

  it("does not revalidate when the task is not his any more (the message must stay)", async () => {
    completeTaskInTransaction.mockResolvedValue({ kind: "not-assigned" });
    await completeTask(null, valid());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("gives a technical problem without leaking the error, and logs only its kind", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("secret detail"), { code: "40001" }));
    const result = await completeTask(null, valid());
    expect(result).toEqual({
      ok: false,
      kind: "error",
      message: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret detail");
  });
});
