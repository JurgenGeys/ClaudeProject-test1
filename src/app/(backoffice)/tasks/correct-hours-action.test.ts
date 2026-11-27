import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested against a real database in
// `src/db/correct-hours.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const correctHoursInTransaction = vi.fn();
vi.mock("@/lib/tasks/correct-hours", () => ({
  correctHoursInTransaction: (...args: unknown[]) => correctHoursInTransaction(...args),
}));
vi.mock("@/lib/tasks/reset", () => ({ resetTaskInTransaction: vi.fn() }));
vi.mock("@/lib/tasks/update", () => ({ updateTaskInTransaction: vi.fn() }));
vi.mock("@/lib/tasks/create", () => ({ createTaskInTransaction: vi.fn() }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthError } from "@/lib/auth/session";

import { correctHours } from "./actions";

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
  correctedMinutes: "90",
  reason: "Pauze niet afgetrokken",
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
  correctHoursInTransaction.mockResolvedValue({
    kind: "corrected",
    id: "t-1",
    number: 1043,
    correctedMinutes: 90,
  });
});

async function run(overrides: Record<string, string> = {}) {
  try {
    return {
      result: await correctHours(null, form({ ...fields, ...overrides })),
      redirected: null,
    };
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

describe("correctHours: who may do it", () => {
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
    await expect(correctHours(null, form(fields))).rejects.toThrow("boom");
  });
});

describe("correctHours: validation", () => {
  it("returns a message per field and does not open a transaction", async () => {
    const { result } = await run({ correctedMinutes: "", reason: "" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        correctedMinutes: "Vul de nieuwe uren in. Dat moet minstens 0u15 zijn.",
        reason: "Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'.",
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses more than 16u00 and no whole quarters", async () => {
    expect((await run({ correctedMinutes: "975" })).result).toMatchObject({
      fieldErrors: { correctedMinutes: "De nieuwe uren mogen niet meer zijn dan 16u00." },
    });
    expect((await run({ correctedMinutes: "20" })).result).toMatchObject({
      fieldErrors: { correctedMinutes: "Vul de nieuwe uren in per kwartier, bv. 1u30." },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["taskNumber", "abc"],
    ["version", ""],
  ])("a form with a wrong %s (%j) is answered like a changed task", async (key, value) => {
    expect((await run({ [key]: value })).result).toEqual(CHANGED);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ignores the status, the original hours and the corrector of a forged form", async () => {
    await run({ status: "invoiced", workedMinutes: "15", correctedBy: "x", updatedBy: "x" });
    const [, input] = correctHoursInTransaction.mock.calls[0];
    expect(input.data).toEqual({
      number: 1043,
      version,
      correctedMinutes: 90,
      reason: "Pauze niet afgetrokken",
    });
    expect(input.actor).toEqual({ id: "s1", role: "backoffice", isActive: true });
  });
});

describe("correctHours: correcting", () => {
  it("runs one transaction, refreshes the task pages and continues to the task page", async () => {
    const { redirected } = await run();
    expect(redirected).toBe("/tasks/1043?corrected=1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(correctHoursInTransaction).toHaveBeenCalledWith(tx, expect.anything());
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1043");
  });
});

describe("correctHours: what the transaction refuses", () => {
  it("says the task changed meanwhile, with a button to reload", async () => {
    correctHoursInTransaction.mockResolvedValue({ kind: "changed" });
    expect((await run()).result).toEqual(CHANGED);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the task is invoiced, with the text of the design, and offers to reload", async () => {
    correctHoursInTransaction.mockResolvedValue({ kind: "invoiced" });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: {},
      formError:
        "Deze taak is al gefactureerd. Maak eerst de markering ongedaan als je de uren wilt wijzigen.",
      reload: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the task does not exist", async () => {
    correctHoursInTransaction.mockResolvedValue({ kind: "not-found" });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze taak bestaat niet (meer).",
    });
  });

  it("answers a refusal of the actor with a technical problem", async () => {
    correctHoursInTransaction.mockResolvedValue({ kind: "refused", reason: "wrong_role" });
    expect((await run()).result).toMatchObject({ ok: false, fieldErrors: {} });
    // Only the reason is logged, not the form (the reason of the correction is free text).
    expect(consoleError).toHaveBeenCalledWith("Correcting hours was refused:", "wrong_role");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("Pauze niet afgetrokken");
  });

  it("answers a failing transaction with a technical problem, and logs only the kind of error", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("secret SQL text"), { code: "40001" }));
    const { result } = await run();
    expect(result).toMatchObject({ ok: false, fieldErrors: {} });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret SQL text");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
