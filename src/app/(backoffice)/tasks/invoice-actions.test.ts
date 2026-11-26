import { beforeEach, describe, expect, it, vi } from "vitest";

// Neither module may load for real in a unit test: `server-only` throws outside a server
// bundle and the database client needs DATABASE_URL.
vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  // Keep the real AuthError class: the actions recognize it with `instanceof`.
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested in `src/lib/tasks/invoice.test.ts` and against a
// real database in `src/db/invoice.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const markInvoicedInTransaction = vi.fn();
const unmarkInvoicedInTransaction = vi.fn();
vi.mock("@/lib/tasks/invoice", () => ({
  markInvoicedInTransaction: (...args: unknown[]) => markInvoicedInTransaction(...args),
  unmarkInvoicedInTransaction: (...args: unknown[]) => unmarkInvoicedInTransaction(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthError } from "@/lib/auth/session";

import { markInvoiced, unmarkInvoiced } from "./invoice-actions";

const V = "2026-11-25T18:44:00.123456Z";
const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) {
    data.append(key, value);
  }
  return data;
}

const markForm = (view: string, ...numbers: number[]) =>
  form([["view", view], ...numbers.map((n): [string, string] => ["task", `${n}@${V}`])]);

/** Runs an action and returns the path it redirected to, or its result when it did not. */
async function run<T>(action: () => Promise<T>) {
  try {
    return { result: await action(), redirected: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { result: null, redirected: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(sofie);
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  markInvoicedInTransaction.mockResolvedValue({
    kind: "done",
    marked: [1001],
    alreadyInvoiced: [],
    changed: [],
  });
  unmarkInvoicedInTransaction.mockResolvedValue({ kind: "unmarked", number: 1001 });
});

describe("markInvoiced: who may do it", () => {
  it("requires the backoffice role before it reads the form or touches the database", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const { result } = await run(() => markInvoiced(null, markForm("list", 1001)));
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(result).toEqual({
      ok: false,
      kind: "error",
      message: "Je hebt geen toegang om dit te doen.",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("gives a technician, a switched-off user and a signed-out visitor no way in", async () => {
    for (const code of ["forbidden", "inactive", "unauthenticated"] as const) {
      requireRole.mockRejectedValue(new AuthError(code));
      const { result } = await run(() => markInvoiced(null, markForm("list", 1001)));
      expect(result).toMatchObject({ ok: false, kind: "error" });
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not swallow an unexpected error of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(markInvoiced(null, markForm("list", 1001))).rejects.toThrow("boom");
  });
});

describe("markInvoiced: the form", () => {
  it.each([
    ["no tasks", form([["view", "list"]])],
    [
      "an invalid version",
      form([
        ["view", "list"],
        ["task", "1001@nonsense"],
      ]),
    ],
    ["the same task twice", markForm("list", 1001, 1001)],
    ["an unknown view", markForm("elsewhere", 1001)],
  ])("answers %s like a task that changed, without touching the database", async (_name, data) => {
    const { result } = await run(() => markInvoiced(null, data));
    expect(result).toEqual({
      ok: false,
      kind: "nothing",
      problems: ["Deze taak is intussen gewijzigd. Bekijk de taak opnieuw."],
      reload: true,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("hands only the user of the session and the numbers with their versions to the transaction", async () => {
    const data = markForm("list", 1001, 1002);
    data.set("status", "invoiced");
    data.set("invoicedBy", "somebody-else");
    markInvoicedInTransaction.mockResolvedValue({
      kind: "done",
      marked: [1001, 1002],
      alreadyInvoiced: [],
      changed: [],
    });
    await markInvoiced(null, data);
    expect(markInvoicedInTransaction).toHaveBeenCalledWith(tx, {
      actor: { id: "s1", role: "backoffice", isActive: true },
      tasks: [
        { number: 1001, version: V },
        { number: 1002, version: V },
      ],
    });
  });
});

describe("markInvoiced: the result", () => {
  it("confirms what was marked and refreshes the overview and the tasks", async () => {
    markInvoicedInTransaction.mockResolvedValue({
      kind: "done",
      marked: [1001, 1002, 1003],
      alreadyInvoiced: [],
      changed: [],
    });
    const { result } = await run(() => markInvoiced(null, markForm("list", 1001, 1002, 1003)));
    expect(result).toEqual({
      ok: true,
      success: '3 taken gemarkeerd als gefactureerd. Je vindt ze terug onder "Gefactureerd".',
      problems: [],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1002");
  });

  it("reports what was left out next to what was marked", async () => {
    markInvoicedInTransaction.mockResolvedValue({
      kind: "done",
      marked: [1001],
      alreadyInvoiced: [1002, 1003],
      changed: [1004],
    });
    const { result } = await run(() =>
      markInvoiced(null, markForm("list", 1001, 1002, 1003, 1004)),
    );
    expect(result).toEqual({
      ok: true,
      success: 'Taak gemarkeerd als gefactureerd. Je vindt de taak terug onder "Gefactureerd".',
      problems: [
        "2 taken waren al gefactureerd.",
        "1 taak is intussen gewijzigd en is niet gemarkeerd. Controleer de taak en probeer opnieuw.",
      ],
    });
  });

  it("says nothing was marked when nothing was, and still refreshes (the versions are old)", async () => {
    markInvoicedInTransaction.mockResolvedValue({
      kind: "done",
      marked: [],
      alreadyInvoiced: [1001],
      changed: [],
    });
    const { result } = await run(() => markInvoiced(null, markForm("list", 1001)));
    expect(result).toEqual({
      ok: false,
      kind: "nothing",
      problems: ["1 taak was al gefactureerd."],
      reload: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("from the page of one task, a success redirects to it with the confirmation and refreshes it", async () => {
    const { redirected } = await run(() => markInvoiced(null, markForm("task", 1001)));
    expect(redirected).toBe("/tasks/1001?invoiced=marked");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1001");
  });

  it("from the page of one task, a refusal does not refresh anything: the dialog with the message must stay", async () => {
    markInvoicedInTransaction.mockResolvedValue({
      kind: "done",
      marked: [],
      alreadyInvoiced: [1001],
      changed: [],
    });
    await run(() => markInvoiced(null, markForm("task", 1001)));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses the page of one task with more than one task, without touching the database", async () => {
    const { result } = await run(() => markInvoiced(null, markForm("task", 1001, 1002)));
    expect(result).toMatchObject({ ok: false, kind: "nothing", reload: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["already invoiced", { alreadyInvoiced: [1001], changed: [] }, "Deze taak is al gefactureerd."],
    [
      "changed",
      { alreadyInvoiced: [], changed: [1001] },
      "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
    ],
  ])(
    "from the page of one task, a task that is %s gives its message and a reload button",
    async (_name, lists, message) => {
      markInvoicedInTransaction.mockResolvedValue({ kind: "done", marked: [], ...lists });
      const { result, redirected } = await run(() => markInvoiced(null, markForm("task", 1001)));
      expect(redirected).toBeNull();
      expect(result).toEqual({ ok: false, kind: "nothing", problems: [message], reload: true });
    },
  );

  it("gives a technical problem a calm message and logs only the kind of error", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("secret detail"), { code: "40P01" }));
    const { result } = await run(() => markInvoiced(null, markForm("list", 1001)));
    expect(result).toEqual({
      ok: false,
      kind: "error",
      message: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret detail");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not expect a refusal of the rules for a signed-in backoffice user", async () => {
    markInvoicedInTransaction.mockResolvedValue({ kind: "refused", reason: "wrong_role" });
    const { result } = await run(() => markInvoiced(null, markForm("list", 1001)));
    expect(result).toMatchObject({ ok: false, kind: "error" });
  });
});

describe("unmarkInvoiced", () => {
  const data = () => form([["task", `1001@${V}`]]);

  it("requires the backoffice role first", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const { result } = await run(() => unmarkInvoiced(null, data()));
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(result).toEqual({
      ok: false,
      message: "Je hebt geen toegang om dit te doen.",
      reload: false,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("answers a form that is not valid like a task that changed", async () => {
    const { result } = await run(() => unmarkInvoiced(null, form([["task", "nonsense"]])));
    expect(result).toMatchObject({ ok: false, reload: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("redirects to the task page with the confirmation after a success", async () => {
    const { redirected } = await run(() => unmarkInvoiced(null, data()));
    expect(redirected).toBe("/tasks/1001?invoiced=unmarked");
    expect(unmarkInvoicedInTransaction).toHaveBeenCalledWith(tx, {
      actor: { id: "s1", role: "backoffice", isActive: true },
      number: 1001,
      version: V,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1001");
  });

  it("says the task changed, with a reload button, when a colleague took the mark off first, and does not refresh the page", async () => {
    unmarkInvoicedInTransaction.mockResolvedValue({ kind: "changed" });
    const { result } = await run(() => unmarkInvoiced(null, data()));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
      reload: true,
    });
  });

  it("says the task does not exist", async () => {
    unmarkInvoicedInTransaction.mockResolvedValue({ kind: "not-found" });
    const { result } = await run(() => unmarkInvoiced(null, data()));
    expect(result).toEqual({
      ok: false,
      message: "Deze taak bestaat niet (meer).",
      reload: false,
    });
  });

  it("gives a technical problem a calm message", async () => {
    transaction.mockRejectedValue(new Error("down"));
    const { result } = await run(() => unmarkInvoiced(null, data()));
    expect(result).toMatchObject({ ok: false, reload: false });
    expect(consoleError).toHaveBeenCalled();
  });
});
