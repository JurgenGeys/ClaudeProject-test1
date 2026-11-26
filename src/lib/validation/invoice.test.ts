import { describe, expect, it } from "vitest";

import {
  formatTaskRef,
  INVOICE_TASK_FIELD,
  MAX_INVOICE_SELECTION,
  parseMarkInvoicedForm,
  parseTaskRef,
  parseUnmarkInvoicedForm,
} from "./invoice";

const V = "2026-11-25T18:44:00.123456Z";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) {
    data.append(key, value);
  }
  return data;
}

const refs = (...numbers: number[]): [string, string][] =>
  numbers.map((number) => [INVOICE_TASK_FIELD, `${number}@${V}`]);

describe("parseTaskRef", () => {
  it("reads a number and a version", () => {
    expect(parseTaskRef(`1043@${V}`)).toEqual({ number: 1043, version: V });
  });

  it("is the counterpart of formatTaskRef", () => {
    expect(parseTaskRef(formatTaskRef({ number: 7, version: V }))).toEqual({
      number: 7,
      version: V,
    });
  });

  it.each([
    null,
    42,
    "",
    "1043",
    `@${V}`,
    `01043@${V}`,
    `0@${V}`,
    `-5@${V}`,
    `1e3@${V}`,
    `1043@`,
    "1043@yesterday",
    `1043@${V}x`,
    `1043@2026-02-30T18:44:00.123456Z`,
    `1234567890@${V}`,
    `1043@${V}@${V}`,
    `${"1".repeat(70)}`,
  ])("refuses %j", (value) => {
    expect(parseTaskRef(value)).toBeNull();
  });
});

describe("parseMarkInvoicedForm", () => {
  it("reads the tasks and where the request comes from", () => {
    const parsed = parseMarkInvoicedForm(form([...refs(1043, 1040), ["view", "list"]]));
    expect(parsed).toEqual({
      ok: true,
      data: {
        view: "list",
        tasks: [
          { number: 1043, version: V },
          { number: 1040, version: V },
        ],
      },
    });
  });

  it("ignores everything else in the form: status, user, time", () => {
    const parsed = parseMarkInvoicedForm(
      form([
        ...refs(1043),
        ["view", "task"],
        ["status", "invoiced"],
        ["invoicedBy", "someone"],
        ["invoicedAt", "2020-01-01"],
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      data: { view: "task", tasks: [{ number: 1043, version: V }] },
    });
  });

  it("refuses an empty selection", () => {
    expect(parseMarkInvoicedForm(form([["view", "list"]]))).toEqual({ ok: false });
  });

  it("accepts a whole page and refuses more", () => {
    const page = Array.from({ length: MAX_INVOICE_SELECTION }, (_, index) => 1001 + index);
    expect(parseMarkInvoicedForm(form([...refs(...page), ["view", "list"]])).ok).toBe(true);
    expect(parseMarkInvoicedForm(form([...refs(...page, 9999), ["view", "list"]]))).toEqual({
      ok: false,
    });
  });

  it("refuses the same task twice", () => {
    expect(parseMarkInvoicedForm(form([...refs(1043, 1043), ["view", "list"]]))).toEqual({
      ok: false,
    });
  });

  it("refuses one invalid task in the list", () => {
    expect(
      parseMarkInvoicedForm(
        form([...refs(1043), [INVOICE_TASK_FIELD, "1044@nonsense"], ["view", "list"]]),
      ),
    ).toEqual({ ok: false });
  });

  it("lets the page of one task send exactly one task", () => {
    expect(parseMarkInvoicedForm(form([...refs(1043), ["view", "task"]])).ok).toBe(true);
    expect(parseMarkInvoicedForm(form([...refs(1043, 1044), ["view", "task"]]))).toEqual({
      ok: false,
    });
    expect(parseMarkInvoicedForm(form([...refs(1043, 1044), ["view", "list"]])).ok).toBe(true);
  });

  it("refuses an unknown or missing view", () => {
    expect(parseMarkInvoicedForm(form([...refs(1043), ["view", "other"]]))).toEqual({ ok: false });
    expect(parseMarkInvoicedForm(form(refs(1043)))).toEqual({ ok: false });
  });
});

describe("parseUnmarkInvoicedForm", () => {
  it("reads one task", () => {
    expect(parseUnmarkInvoicedForm(form(refs(1043)))).toEqual({
      ok: true,
      data: { number: 1043, version: V },
    });
  });

  it("refuses a missing or invalid task", () => {
    expect(parseUnmarkInvoicedForm(form([]))).toEqual({ ok: false });
    expect(parseUnmarkInvoicedForm(form([[INVOICE_TASK_FIELD, "x"]]))).toEqual({ ok: false });
  });
});
