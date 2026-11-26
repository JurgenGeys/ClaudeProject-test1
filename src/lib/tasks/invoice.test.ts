import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  markInvoicedInTransaction,
  unmarkInvoicedInTransaction,
  type InvoiceTransaction,
} from "./invoice";
import type { TaskStatus } from "./types";

// The decisions per task, against a stand-in transaction. What the SQL does (locks, order, the
// version, the check constraints, races) is tested against a real database in
// `src/db/invoice.db.test.ts`.

const V1 = "2026-11-25T18:44:00.123456Z";
const V2 = "2026-11-25T19:00:00.000001Z";
const office = { id: "office", role: "backoffice" as const, isActive: true };

type Row = { id: string; number: number; status: TaskStatus; version: string };

/**
 * `touched` are the rows that the update reports as changed (all rows by default); `updated`
 * cuts that list short, to play a database that misses a locked row.
 */
function fakeTx(rows: Row[], updated?: number, touched: Row[] = rows) {
  const set = vi.fn();
  const calls = { updates: 0 };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ for: async () => rows }),
          for: async () => rows,
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        set(values);
        calls.updates += 1;
        return {
          where: () => ({
            returning: async () =>
              touched
                .slice(0, updated ?? touched.length)
                .map((row) => ({ id: row.id, number: row.number })),
          }),
        };
      },
    }),
  } as unknown as InvoiceTransaction;
  return { tx, set, calls };
}

const row = (number: number, status: TaskStatus, version = V1): Row => ({
  id: `id-${number}`,
  number,
  status,
  version,
});

describe("markInvoicedInTransaction", () => {
  it("marks Afgewerkt tasks whose version is still the one that was shown", async () => {
    const { tx, set } = fakeTx([row(1001, "completed"), row(1002, "completed")]);
    const outcome = await markInvoicedInTransaction(tx, {
      actor: office,
      tasks: [
        { number: 1002, version: V1 },
        { number: 1001, version: V1 },
      ],
    });
    expect(outcome).toEqual({
      kind: "done",
      marked: [1001, 1002],
      alreadyInvoiced: [],
      changed: [],
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "invoiced", invoicedBy: "office", updatedBy: "office" }),
    );
  });

  it("reports a Gefactureerd task and leaves it alone, whatever its version", async () => {
    const { tx, set } = fakeTx([row(1001, "invoiced", V2), row(1002, "completed")], undefined, [
      row(1002, "completed"),
    ]);
    const outcome = await markInvoicedInTransaction(tx, {
      actor: office,
      tasks: [
        { number: 1001, version: V1 },
        { number: 1002, version: V1 },
      ],
    });
    expect(outcome).toEqual({ kind: "done", marked: [1002], alreadyInvoiced: [1001], changed: [] });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("does not mark a task that changed since the page was opened", async () => {
    const { tx, calls } = fakeTx([row(1001, "completed", V2)]);
    const outcome = await markInvoicedInTransaction(tx, {
      actor: office,
      tasks: [{ number: 1001, version: V1 }],
    });
    expect(outcome).toEqual({ kind: "done", marked: [], alreadyInvoiced: [], changed: [1001] });
    expect(calls.updates).toBe(0);
  });

  it.each(["open", "assigned", "picked_up", "cancelled"] as const)(
    "does not mark a task that is %s",
    async (status) => {
      const { tx, calls } = fakeTx([row(1001, status)]);
      const outcome = await markInvoicedInTransaction(tx, {
        actor: office,
        tasks: [{ number: 1001, version: V1 }],
      });
      expect(outcome).toMatchObject({ kind: "done", marked: [], changed: [1001] });
      expect(calls.updates).toBe(0);
    },
  );

  it("reports a number that does not exist", async () => {
    const { tx } = fakeTx([]);
    const outcome = await markInvoicedInTransaction(tx, {
      actor: office,
      tasks: [{ number: 4040, version: V1 }],
    });
    expect(outcome).toMatchObject({ kind: "done", marked: [], changed: [4040] });
  });

  it("refuses a technician and an inactive user, and writes nothing", async () => {
    const technician = fakeTx([row(1001, "completed")]);
    expect(
      await markInvoicedInTransaction(technician.tx, {
        actor: { id: "t", role: "technician", isActive: true },
        tasks: [{ number: 1001, version: V1 }],
      }),
    ).toEqual({ kind: "refused", reason: "wrong_role" });
    expect(technician.calls.updates).toBe(0);

    const inactive = fakeTx([row(1001, "completed")]);
    expect(
      await markInvoicedInTransaction(inactive.tx, {
        actor: { ...office, isActive: false },
        tasks: [{ number: 1001, version: V1 }],
      }),
    ).toEqual({ kind: "refused", reason: "actor_inactive" });
  });

  it("throws, so the transaction rolls back, when the update misses a locked task", async () => {
    const { tx } = fakeTx([row(1001, "completed"), row(1002, "completed")], 1);
    await expect(
      markInvoicedInTransaction(tx, {
        actor: office,
        tasks: [
          { number: 1001, version: V1 },
          { number: 1002, version: V1 },
        ],
      }),
    ).rejects.toThrow("markInvoiced");
  });
});

describe("unmarkInvoicedInTransaction", () => {
  const input = { actor: office, number: 1001, version: V1 };

  it("takes the mark off a Gefactureerd task", async () => {
    const { tx, set } = fakeTx([row(1001, "invoiced")]);
    expect(await unmarkInvoicedInTransaction(tx, input)).toEqual({
      kind: "unmarked",
      number: 1001,
    });
    expect(set).toHaveBeenCalledWith({
      status: "completed",
      invoicedAt: null,
      invoicedBy: null,
      updatedBy: "office",
    });
  });

  it("says not-found for an unknown number", async () => {
    const { tx } = fakeTx([]);
    expect(await unmarkInvoicedInTransaction(tx, input)).toEqual({ kind: "not-found" });
  });

  it.each(["open", "assigned", "picked_up", "completed", "cancelled"] as const)(
    "says changed for a task that is %s",
    async (status) => {
      const { tx, calls } = fakeTx([row(1001, status)]);
      expect(await unmarkInvoicedInTransaction(tx, input)).toEqual({ kind: "changed" });
      expect(calls.updates).toBe(0);
    },
  );

  it("says changed when the version differs", async () => {
    const { tx, calls } = fakeTx([row(1001, "invoiced", V2)]);
    expect(await unmarkInvoicedInTransaction(tx, input)).toEqual({ kind: "changed" });
    expect(calls.updates).toBe(0);
  });

  it("refuses a technician", async () => {
    const { tx } = fakeTx([row(1001, "invoiced")]);
    expect(
      await unmarkInvoicedInTransaction(tx, {
        ...input,
        actor: { id: "t", role: "technician", isActive: true },
      }),
    ).toEqual({ kind: "refused", reason: "wrong_role" });
  });
});
