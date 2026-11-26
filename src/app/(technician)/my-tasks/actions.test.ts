import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested against a real database in
// `src/db/pick-up-task.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const pickUpTaskInTransaction = vi.fn();
vi.mock("@/lib/tasks/pick-up", () => ({
  pickUpTaskInTransaction: (...args: unknown[]) => pickUpTaskInTransaction(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { AuthError } from "@/lib/auth/session";

import { pickUpTask } from "./actions";

const VERSION = "2026-11-25T18:44:00.123456Z";
const kevin = { id: "k1", email: "k@x.be", fullName: "Kevin Wouters", role: "technician" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}
const valid = () => form({ taskNumber: "1042", version: VERSION });

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(kevin);
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  pickUpTaskInTransaction.mockResolvedValue({
    kind: "picked-up",
    id: "t1",
    number: 1042,
    pickedUpAt: new Date("2026-11-26T07:48:00Z"),
  });
});

describe("pickUpTask: access", () => {
  it("checks the technician role before anything else", async () => {
    const order: string[] = [];
    requireRole.mockImplementation(async () => {
      order.push("requireRole");
      return kevin;
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      order.push("transaction");
      return callback(tx);
    });
    await pickUpTask(null, valid());
    expect(requireRole).toHaveBeenCalledWith("technician");
    expect(order).toEqual(["requireRole", "transaction"]);
  });

  it.each([
    ["forbidden", "Je hebt geen toegang om dit te doen."],
    ["unauthenticated", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["inactive", "Je account is uitgeschakeld. Neem contact op met kantoor."],
    ["unavailable", "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw."],
  ] as const)(
    "refuses %s without validating, reading or writing anything",
    async (code, message) => {
      requireRole.mockRejectedValue(new AuthError(code));
      expect(await pickUpTask(null, valid())).toEqual({ ok: false, kind: "error", message });
      expect(transaction).not.toHaveBeenCalled();
      expect(pickUpTaskInTransaction).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("does not swallow an error that is not an AuthError", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(pickUpTask(null, valid())).rejects.toThrow("boom");
  });
});

describe("pickUpTask: input", () => {
  it("takes the technician from the session and only the number and the version from the form", async () => {
    await pickUpTask(
      null,
      form({
        taskNumber: "1042",
        version: VERSION,
        assigneeId: "someone-else",
        actorId: "someone-else",
        status: "completed",
      }),
    );
    expect(pickUpTaskInTransaction).toHaveBeenCalledWith(tx, {
      actor: { id: "k1", role: "technician", isActive: true },
      number: 1042,
      version: VERSION,
    });
  });

  it.each([
    ["no number", { version: VERSION }],
    ["a number that is not valid", { taskNumber: "10x2", version: VERSION }],
    ["no version", { taskNumber: "1042" }],
    ["a version that is not valid", { taskNumber: "1042", version: "now" }],
  ])("answers a form with %s like a task that changed, without the database", async (_, fields) => {
    expect(await pickUpTask(null, form(fields))).toEqual({
      ok: false,
      kind: "changed",
      message: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("pickUpTask: the result", () => {
  it("is ok when picked up, and refreshes the lists and pages of the technician and the office", async () => {
    expect(await pickUpTask(null, valid())).toEqual({ ok: true });
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toEqual(["/my-tasks", "/my-tasks/1042", "/tasks", "/tasks/1042"]);
  });

  it("says the task is not his any more (moved, reassigned, unknown) and refreshes nothing", async () => {
    pickUpTaskInTransaction.mockResolvedValue({ kind: "not-assigned" });
    expect(await pickUpTask(null, valid())).toEqual({
      ok: false,
      kind: "not-assigned",
      message: "Deze taak is niet meer aan jou toegewezen.",
    });
    // A refresh could turn this page into "not found" and take the message away.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the task was cancelled and refreshes the page of the task, which then shows it", async () => {
    pickUpTaskInTransaction.mockResolvedValue({ kind: "cancelled" });
    expect(await pickUpTask(null, valid())).toEqual({
      ok: false,
      kind: "cancelled",
      message: "Deze taak is geannuleerd door kantoor. Je hoeft niets meer te doen.",
    });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/my-tasks",
      "/my-tasks/1042",
    ]);
  });

  it("says the task changed meanwhile (edited, picked up already, finished)", async () => {
    pickUpTaskInTransaction.mockResolvedValue({ kind: "changed" });
    expect(await pickUpTask(null, valid())).toEqual({
      ok: false,
      kind: "changed",
      message: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
    });
    // The button "Pagina herladen" reads the page again; a refresh here could hide the message.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("tells a technician who was switched off meanwhile", async () => {
    pickUpTaskInTransaction.mockResolvedValue({ kind: "inactive" });
    expect(await pickUpTask(null, valid())).toEqual({
      ok: false,
      kind: "error",
      message: "Je account is uitgeschakeld. Neem contact op met kantoor.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("gives the technical message for a refusal that has no message of its own", async () => {
    pickUpTaskInTransaction.mockResolvedValue({ kind: "refused", reason: "wrong_role" });
    expect(await pickUpTask(null, valid())).toMatchObject({ ok: false, kind: "error" });
  });

  it("gives the technical message when the database fails, and logs only the kind of error", async () => {
    transaction.mockRejectedValue(
      Object.assign(new Error("secret detail 1042"), { code: "57P01" }),
    );
    expect(await pickUpTask(null, valid())).toEqual({
      ok: false,
      kind: "error",
      message: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(consoleError).toHaveBeenCalledWith("Picking up a task failed:", "Error 57P01");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret detail");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
