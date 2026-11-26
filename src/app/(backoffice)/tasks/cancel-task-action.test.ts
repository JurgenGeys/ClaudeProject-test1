import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested against a real database in
// `src/db/cancel-task.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const cancelTaskInTransaction = vi.fn();
vi.mock("@/lib/tasks/cancel", () => ({
  cancelTaskInTransaction: (...args: unknown[]) => cancelTaskInTransaction(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthError } from "@/lib/auth/session";

import { cancelTask } from "./cancel-actions";

const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};
const version = "2026-11-25T18:44:00.123456Z";

const fields: Record<string, string> = {
  taskNumber: "1043",
  version,
  reason: "Klant heeft zelf afgezegd",
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(sofie);
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  cancelTaskInTransaction.mockResolvedValue({ kind: "cancelled", id: "t-1", number: 1043 });
});

async function run(overrides: Record<string, string> = {}) {
  try {
    return { result: await cancelTask(null, form({ ...fields, ...overrides })), redirected: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { result: null, redirected: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
}

const CHANGED = {
  ok: false,
  fieldErrors: {},
  formError: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
  reload: true,
};

describe("cancelTask: who may do it", () => {
  it("requires the backoffice role before it reads the form or touches the database", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const { result } = await run();
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(cancelTask(null, form(fields))).rejects.toThrow("boom");
  });
});

describe("cancelTask: validation", () => {
  it("returns a message under the reason when it is too long, and does not open a transaction", async () => {
    const { result } = await run({ reason: "x".repeat(501) });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { reason: "De reden is te lang. Houd ze korter dan 500 tekens." },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["taskNumber", "abc"],
    ["version", ""],
    ["version", "not a date"],
  ])("a form with a wrong %s (%j) is answered like a changed task", async (key, value) => {
    const { result } = await run({ [key]: value });
    expect(result).toEqual(CHANGED);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("passes only the number, the version and the reason; the actor is the session user", async () => {
    await run({ status: "completed", cancelledBy: "x", cancelledAt: "2020-01-01", updatedBy: "y" });
    const [, input] = cancelTaskInTransaction.mock.calls[0];
    expect(input.data).toEqual({ number: 1043, version, reason: "Klant heeft zelf afgezegd" });
    expect(input.actor).toEqual({ id: "s1", role: "backoffice", isActive: true });
  });

  it("passes no reason as null", async () => {
    await run({ reason: "  " });
    expect(cancelTaskInTransaction.mock.calls[0][1].data.reason).toBeNull();
  });
});

describe("cancelTask: cancelling", () => {
  it("runs one transaction, refreshes the pages of both roles and continues to the task page", async () => {
    const { redirected } = await run();
    expect(redirected).toBe("/tasks/1043?cancelled=1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(cancelTaskInTransaction).toHaveBeenCalledWith(tx, expect.anything());
    for (const path of ["/tasks", "/tasks/1043", "/my-tasks", "/my-tasks/1043"]) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });
});

describe("cancelTask: what the transaction refuses", () => {
  it("says the technician picked the task up meanwhile: call him first, with a way to reload", async () => {
    cancelTaskInTransaction.mockResolvedValue({
      kind: "picked-up",
      technicianName: "Kevin Wouters",
    });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: {},
      formError:
        "Kevin Wouters heeft deze taak intussen opgepikt. Bel hem eerst; zet de taak daarna terug als ze echt niet doorgaat.",
      reload: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("has a message for a picked up task whose technician is not known", async () => {
    cancelTaskInTransaction.mockResolvedValue({ kind: "picked-up", technicianName: null });
    expect((await run()).result).toMatchObject({
      formError: expect.stringContaining("De technieker heeft deze taak intussen opgepikt."),
      reload: true,
    });
  });

  it("says the task changed meanwhile (finished, already cancelled, edited), with a button to reload", async () => {
    cancelTaskInTransaction.mockResolvedValue({ kind: "changed" });
    expect((await run()).result).toEqual(CHANGED);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the task does not exist", async () => {
    cancelTaskInTransaction.mockResolvedValue({ kind: "not-found" });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze taak bestaat niet (meer).",
    });
  });

  it("answers a refusal of the actor with a technical problem", async () => {
    cancelTaskInTransaction.mockResolvedValue({ kind: "refused", reason: "wrong_role" });
    expect((await run()).result).toMatchObject({ ok: false, fieldErrors: {} });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers a failing transaction with the technical problem, and logs only the kind of error", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("secret SQL text"), { code: "40001" }));
    const { result } = await run();
    expect(result).toMatchObject({ ok: false, fieldErrors: {} });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret SQL text");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
