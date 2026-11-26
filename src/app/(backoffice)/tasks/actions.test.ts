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

// `transaction` hands a stand-in transaction to the callback; the rules inside it are tested
// against a real database in `src/db/create-task.db.test.ts`.
const transaction = vi.fn();
const tx = { marker: "tx" };
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  }),
}));
const createTaskInTransaction = vi.fn();
vi.mock("@/lib/tasks/create", () => ({
  createTaskInTransaction: (...args: unknown[]) => createTaskInTransaction(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthError } from "@/lib/auth/session";

import { createTask } from "./actions";

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

const existingCustomer = {
  customerMode: "existing",
  customerId,
  locationStreet: "Kerkstraat 12",
  locationPostalCode: "2310",
  locationCity: "Rijkevorsel",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud",
  scheduledDate: "2026-12-01",
  startTime: "14:00",
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(sofie);
  // Like Drizzle: run the callback, and reject when it throws (the real one rolls back).
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  createTaskInTransaction.mockResolvedValue({
    kind: "created",
    id: "t-1",
    number: 1051,
    status: "open",
  });
});

/** Runs the action and returns the path it redirected to, or the result when it did not. */
async function run(fields: Record<string, string>) {
  try {
    return { result: await createTask(null, form(fields)), redirected: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { result: null, redirected: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
}

describe("createTask: who may do it", () => {
  it("requires the backoffice role before it reads the form or touches the database", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const { result } = await run(existingCustomer);
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(createTaskInTransaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["password-pending", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["inactive", "Je account is uitgeschakeld. Neem contact op met kantoor."],
  ] as const)("refuses a caller who is %s", async (code, formError) => {
    requireRole.mockRejectedValue(new AuthError(code));
    const { result } = await run(existingCustomer);
    expect(result).toMatchObject({ ok: false, formError });
    expect(createTaskInTransaction).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(createTask(null, form(existingCustomer))).rejects.toThrow("boom");
  });
});

describe("createTask: validation", () => {
  it("returns a message per field and does not open a transaction", async () => {
    const { result } = await run({});
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        customerId: "Kies een klant of maak een nieuwe klant aan.",
        locationStreet: "Vul de straat en het huisnummer in.",
        locationPostalCode: "Vul een geldige postcode in (4 cijfers).",
        locationCity: "Vul de gemeente in.",
        workType: "Kies het soort werk: nazicht, onderhoud of herstelling.",
        instructions: "Beschrijf wat de technieker moet doen.",
        scheduledDate: "Kies een datum.",
        startTime: "Kies een startuur.",
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("validates a new customer on the server too", async () => {
    const { result } = await run({
      ...existingCustomer,
      customerMode: "new",
      customerId: "",
      newCustomerName: "",
      newCustomerEmail: "geen-mailadres",
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        newCustomerName: "Vul de naam van de klant in.",
        newCustomerEmail: "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ignores the status and the creator that a forged form sends", async () => {
    await run({ ...existingCustomer, status: "completed", createdBy: "x", number: "1" });
    const [, input] = createTaskInTransaction.mock.calls[0];
    expect(JSON.stringify(input.data)).not.toMatch(/completed|createdBy|number/);
    expect(input.actor).toEqual({ id: "s1", role: "backoffice", isActive: true });
  });
});

describe("createTask: saving", () => {
  it("saves an Open task without a technician and goes to the task page (B3) with the confirmation", async () => {
    const { redirected } = await run(existingCustomer);
    expect(redirected).toBe("/tasks/1051?saved=1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createTaskInTransaction).toHaveBeenCalledWith(tx, {
      actor: { id: "s1", role: "backoffice", isActive: true },
      data: expect.objectContaining({
        customer: { kind: "existing", id: customerId },
        assigneeId: null,
        estimatedMinutes: null,
        startTime: "14:00",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("passes the technician and the duration on for a Toegewezen task", async () => {
    createTaskInTransaction.mockResolvedValue({
      kind: "created",
      id: "t-2",
      number: 1052,
      status: "assigned",
    });
    const { redirected } = await run({
      ...existingCustomer,
      assigneeId: kevinId,
      estimatedMinutes: "90",
    });
    expect(redirected).toBe("/tasks/1052?saved=1");
    expect(createTaskInTransaction.mock.calls[0][1].data).toMatchObject({
      assigneeId: kevinId,
      estimatedMinutes: 90,
    });
  });

  it("saves a new customer with the task, using the location as its address", async () => {
    const { redirected } = await run({
      ...existingCustomer,
      customerMode: "new",
      customerId: "",
      newCustomerName: "Bakkerij De Gouden Korst",
      newCustomerPhone: "014 41 22 87",
    });
    expect(redirected).toBe("/tasks/1051?saved=1");
    expect(createTaskInTransaction.mock.calls[0][1].data.customer).toEqual({
      kind: "new",
      data: {
        name: "Bakkerij De Gouden Korst",
        phone: "014 41 22 87",
        email: null,
        notes: null,
        street: "Kerkstraat 12",
        postalCode: "2310",
        city: "Rijkevorsel",
      },
    });
  });
});

describe("createTask: what the transaction refuses", () => {
  const withKevin = { ...existingCustomer, assigneeId: kevinId };

  it("says that a technician who was switched off meanwhile is no longer active, and refreshes the list", async () => {
    createTaskInTransaction.mockResolvedValue({
      kind: "assignee-inactive",
      fullName: "Kevin Wouters",
    });
    const { result, redirected } = await run(withKevin);
    expect(redirected).toBeNull();
    expect(result).toEqual({
      ok: false,
      fieldErrors: { assigneeId: "Kevin Wouters is niet meer actief. Kies een andere technieker." },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/new");
    expect(revalidatePath).not.toHaveBeenCalledWith("/tasks");
  });

  it("refuses an invited technician who did not accept yet, and refreshes the list", async () => {
    createTaskInTransaction.mockResolvedValue({
      kind: "assignee-invited",
      fullName: "Yana Willems",
    });
    const { result } = await run(withKevin);
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        assigneeId:
          "Yana Willems heeft de uitnodiging nog niet aanvaard. Kies een andere technieker.",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/new");
  });

  it("gives one general message for an unknown id and for a user who is no technician", async () => {
    createTaskInTransaction.mockResolvedValue({ kind: "assignee-not-found" });
    const { result } = await run(withKevin);
    expect(result).toEqual({
      ok: false,
      fieldErrors: { assigneeId: "Kies een technieker uit de lijst." },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a customer that does not exist", async () => {
    createTaskInTransaction.mockResolvedValue({ kind: "customer-not-found" });
    const { result } = await run(existingCustomer);
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { customerId: expect.stringContaining("bestaat niet") },
    });
  });

  it("shows the technical message when the transition rules refuse something unexpected", async () => {
    createTaskInTransaction.mockResolvedValue({ kind: "refused", reason: "actor_inactive" });
    const { result } = await run(existingCustomer);
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
  });

  it("does not redirect or revalidate when the transaction fails, and logs only the kind of error", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("secret form data"), { code: "40001" }));
    const { result, redirected } = await run(existingCustomer);
    expect(redirected).toBeNull();
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret form data");
  });
});
