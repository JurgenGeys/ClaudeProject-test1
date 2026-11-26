import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// The rules inside the transaction are tested against a real database in
// `src/db/update-task.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const updateTaskInTransaction = vi.fn();
vi.mock("@/lib/tasks/update", () => ({
  updateTaskInTransaction: (...args: unknown[]) => updateTaskInTransaction(...args),
}));
vi.mock("@/lib/tasks/create", () => ({ createTaskInTransaction: vi.fn() }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthError } from "@/lib/auth/session";

import { updateTask } from "./actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};
const customerId = "11111111-1111-4111-8111-111111111111";
const kevinId = "22222222-2222-4222-8222-222222222222";
const version = "2026-11-25T18:44:00.123456Z";

const fields = {
  customerMode: "existing",
  customerId,
  locationStreet: "Kerkstraat 12",
  locationPostalCode: "2310",
  locationCity: "Rijkevorsel",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud",
  scheduledDate: "2026-12-01",
  startTime: "14:00",
  taskNumber: "1043",
  version,
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(sofie);
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  updateTaskInTransaction.mockResolvedValue({
    kind: "updated",
    id: "t-1",
    number: 1043,
    status: "assigned",
  });
});

async function run(overrides: Record<string, string> = {}) {
  try {
    return { result: await updateTask(null, form({ ...fields, ...overrides })), redirected: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { result: null, redirected: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
}

describe("updateTask: who may do it", () => {
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
    await expect(updateTask(null, form(fields))).rejects.toThrow("boom");
  });
});

describe("updateTask: validation", () => {
  it("returns a message per field and does not open a transaction", async () => {
    const { result } = await run({ locationStreet: "", startTime: "" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        locationStreet: "Vul de straat en het huisnummer in.",
        startTime: "Kies een startuur.",
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["taskNumber", "abc"],
    ["taskNumber", ""],
    ["version", ""],
    ["version", "not a date"],
  ])(
    "a form with a wrong %s (%j) is answered like a changed task, with a reload",
    async (key, value) => {
      const { result } = await run({ [key]: value });
      expect(result).toEqual({
        ok: false,
        fieldErrors: {},
        formError: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
        reload: true,
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("ignores the status, the editor and the number of a forged form", async () => {
    await run({ status: "completed", updatedBy: "x", number: "1", pickedUpAt: "2020-01-01" });
    const [, input] = updateTaskInTransaction.mock.calls[0];
    expect(JSON.stringify(input.data)).not.toMatch(/completed|updatedBy|pickedUpAt/);
    expect(input.data.number).toBe(1043);
    expect(input.actor).toEqual({ id: "s1", role: "backoffice", isActive: true });
  });
});

describe("updateTask: saving", () => {
  it("passes the task, the version and the actor on, and continues to the task page with the confirmation", async () => {
    const { redirected } = await run({ assigneeId: kevinId, estimatedMinutes: "90" });
    expect(redirected).toBe("/tasks/1043?saved=1");
    expect(updateTaskInTransaction).toHaveBeenCalledWith(tx, {
      actor: { id: "s1", role: "backoffice", isActive: true },
      data: expect.objectContaining({
        number: 1043,
        version,
        customer: { kind: "existing", id: customerId },
        assigneeId: kevinId,
        estimatedMinutes: 90,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1043");
  });

  it("goes to the task page of the number that was saved", async () => {
    updateTaskInTransaction.mockResolvedValue({
      kind: "updated",
      id: "t-9",
      number: 1043,
      status: "open",
    });
    expect((await run({ taskNumber: "1043" })).redirected).toBe("/tasks/1043?saved=1");
  });
});

describe("updateTask: what the transaction refuses", () => {
  it("says the task changed meanwhile, with a button to reload", async () => {
    updateTaskInTransaction.mockResolvedValue({ kind: "changed" });
    const { result } = await run();
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
      reload: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["completed", "Afgewerkt"],
    ["invoiced", "Gefactureerd"],
    ["cancelled", "Geannuleerd"],
  ] as const)("says a %s task can no longer be edited", async (status, label) => {
    updateTaskInTransaction.mockResolvedValue({ kind: "not-editable", status });
    const { result } = await run();
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: `Deze taak is ${label.toLowerCase()} en kan niet meer bewerkt worden.`,
      reload: true,
    });
  });

  it("says the task does not exist", async () => {
    updateTaskInTransaction.mockResolvedValue({ kind: "not-found" });
    expect((await run()).result).toMatchObject({
      ok: false,
      formError: "Deze taak bestaat niet (meer).",
    });
  });

  it("puts the message of a technician who was switched off under his field, and refreshes the edit page", async () => {
    updateTaskInTransaction.mockResolvedValue({
      kind: "assignee-inactive",
      fullName: "Kevin Wouters",
    });
    const { result } = await run({ assigneeId: kevinId });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { assigneeId: "Kevin Wouters is niet meer actief. Kies een andere technieker." },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/1043/edit");
  });

  it("puts the message of an invited technician under his field", async () => {
    updateTaskInTransaction.mockResolvedValue({
      kind: "assignee-invited",
      fullName: "Yana Willems",
    });
    expect((await run({ assigneeId: kevinId })).result).toEqual({
      ok: false,
      fieldErrors: {
        assigneeId:
          "Yana Willems heeft de uitnodiging nog niet aanvaard. Kies een andere technieker.",
      },
    });
  });

  it("puts the message of an unknown technician or customer under their field", async () => {
    updateTaskInTransaction.mockResolvedValue({ kind: "assignee-not-found" });
    expect((await run({ assigneeId: kevinId })).result).toEqual({
      ok: false,
      fieldErrors: { assigneeId: "Kies een technieker uit de lijst." },
    });
    updateTaskInTransaction.mockResolvedValue({ kind: "customer-not-found" });
    expect((await run()).result).toMatchObject({
      ok: false,
      fieldErrors: { customerId: expect.stringContaining("Deze klant bestaat niet") },
    });
  });

  it("refuses another technician for a picked up task, pointing to Terugzetten", async () => {
    updateTaskInTransaction.mockResolvedValue({ kind: "assignee-locked" });
    expect((await run({ assigneeId: kevinId })).result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Deze taak is opgepikt. Gebruik 'Terugzetten' om een andere technieker te kiezen.",
    });
  });

  it("gives the technical message for a refusal of the rules and for a database error, and logs only the kind", async () => {
    updateTaskInTransaction.mockResolvedValue({ kind: "refused", reason: "actor_inactive" });
    expect((await run()).result).toMatchObject({
      ok: false,
      formError: expect.stringContaining("Dat is niet gelukt"),
    });

    transaction.mockRejectedValue(Object.assign(new Error("secret form data"), { code: "40001" }));
    const { result } = await run();
    expect(result).toMatchObject({
      ok: false,
      formError: expect.stringContaining("Dat is niet gelukt"),
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret form data");
  });
});
