import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested against a real database in
// `src/db/reset-task.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const resetTaskInTransaction = vi.fn();
vi.mock("@/lib/tasks/reset", () => ({
  resetTaskInTransaction: (...args: unknown[]) => resetTaskInTransaction(...args),
}));
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

import { resetTask } from "./actions";

const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};
const kevinId = "22222222-2222-4222-8222-222222222222";
const version = "2026-11-25T18:44:00.123456Z";

const fields: Record<string, string> = {
  taskNumber: "1043",
  version,
  assigneeId: kevinId,
  scheduledDate: "2026-12-01",
  startTime: "08:00",
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
  resetTaskInTransaction.mockResolvedValue({
    kind: "reset",
    id: "t-1",
    number: 1043,
    assigneeName: "Kevin Wouters",
    scheduledDate: "2026-12-01",
    startTime: "08:00:00",
  });
});

async function run(overrides: Record<string, string> = {}) {
  try {
    return { result: await resetTask(null, form({ ...fields, ...overrides })), redirected: null };
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

describe("resetTask: who may do it", () => {
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
    await expect(resetTask(null, form(fields))).rejects.toThrow("boom");
  });
});

describe("resetTask: validation", () => {
  it("returns a message per field and does not open a transaction", async () => {
    const { result } = await run({ assigneeId: "", startTime: "" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        assigneeId: "Kies een technieker uit de lijst.",
        startTime: "Kies een startuur.",
      },
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

  it("ignores the status, the pick-up time and the editor of a forged form", async () => {
    await run({ status: "completed", pickedUpAt: "2020-01-01", updatedBy: "x" });
    const [, input] = resetTaskInTransaction.mock.calls[0];
    expect(input.data).toEqual({
      number: 1043,
      version,
      assigneeId: kevinId,
      scheduledDate: "2026-12-01",
      startTime: "08:00",
    });
    expect(input.actor).toEqual({ id: "s1", role: "backoffice", isActive: true });
  });
});

describe("resetTask: resetting", () => {
  it("runs one transaction, refreshes the pages of both roles and continues to the task page", async () => {
    const { redirected } = await run();
    expect(redirected).toBe("/tasks/1043?reset=1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(resetTaskInTransaction).toHaveBeenCalledWith(tx, expect.anything());
    for (const path of ["/tasks", "/tasks/1043", "/my-tasks", "/my-tasks/1043"]) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });
});

describe("resetTask: what the transaction refuses", () => {
  it("says the task changed meanwhile (finished, reset, edited), with a button to reload", async () => {
    resetTaskInTransaction.mockResolvedValue({ kind: "changed" });
    const { result } = await run();
    expect(result).toEqual(CHANGED);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the task does not exist", async () => {
    resetTaskInTransaction.mockResolvedValue({ kind: "not-found" });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze taak bestaat niet (meer).",
    });
  });

  it("puts the message of a technician who was switched off under his field and refreshes the page", async () => {
    resetTaskInTransaction.mockResolvedValue({
      kind: "assignee-inactive",
      fullName: "Kevin Wouters",
    });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: { assigneeId: "Kevin Wouters is niet meer actief. Kies een andere technieker." },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1043");
  });

  it("puts the message of an invited technician under his field", async () => {
    resetTaskInTransaction.mockResolvedValue({
      kind: "assignee-invited",
      fullName: "Yana Willems",
    });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: {
        assigneeId:
          "Yana Willems heeft de uitnodiging nog niet aanvaard. Kies een andere technieker.",
      },
    });
  });

  it("puts the message of an unknown technician under his field", async () => {
    resetTaskInTransaction.mockResolvedValue({ kind: "assignee-not-found" });
    expect((await run()).result).toEqual({
      ok: false,
      fieldErrors: { assigneeId: "Kies een technieker uit de lijst." },
    });
  });

  it("answers a refusal of the actor with a technical problem", async () => {
    resetTaskInTransaction.mockResolvedValue({ kind: "refused", reason: "wrong_role" });
    expect((await run()).result).toMatchObject({ ok: false, fieldErrors: {} });
  });

  it("answers a failing transaction with the technical problem, and logs only the kind of error", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("secret SQL text"), { code: "40001" }));
    const { result } = await run();
    expect(result).toMatchObject({ ok: false, fieldErrors: {} });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret SQL text");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
