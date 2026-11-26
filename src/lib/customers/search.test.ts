import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PgDialect } from "drizzle-orm/pg-core";

import { customerMatchCondition, escapeLike, findCustomers, withoutSpaces } from "./search";

describe("escapeLike", () => {
  it("takes %, _ and the backslash literally", () => {
    expect(escapeLike("50%_off\\x")).toBe("50\\%\\_off\\\\x");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("Bakkerij De Gouden Korst")).toBe("Bakkerij De Gouden Korst");
  });
});

describe("withoutSpaces", () => {
  it("removes every kind of white space, inside and around the text", () => {
    expect(withoutSpaces(" 014 41\u00a022\t87 ")).toBe("014412287");
    expect(withoutSpaces("014412287")).toBe("014412287");
    expect(withoutSpaces("   ")).toBe("");
  });
});

describe("customerMatchCondition", () => {
  const dialect = new PgDialect();
  const render = (text: string) => dialect.sqlToQuery(customerMatchCondition(text));

  it("compares the phone number without spaces on both sides", () => {
    const { sql, params } = render("014 41 22");
    expect(sql).toContain("regexp_replace");
    expect(sql).toContain("[[:space:]]");
    // The name and the city keep the spaces that were typed; the phone number does not.
    expect(params).toEqual(["%014 41 22%", "%014 41 22%", "%0144122%"]);
  });

  it("takes %, _ and the backslash literally in the name, the city and the phone number", () => {
    expect(render("50%_x").params).toEqual(["%50\\%\\_x%", "%50\\%\\_x%", "%50\\%\\_x%"]);
  });

  it("trims the text and passes it as values, never as SQL text", () => {
    const { sql, params } = render("  x'; drop table customers; --  ");
    expect(sql).not.toContain("drop table");
    expect(params[0]).toBe("%x'; drop table customers; --%");
  });
});

describe("findCustomers", () => {
  it("does not query for a text that is too short", async () => {
    const select = vi.fn();
    expect(await findCustomers({ select } as never, " b ")).toEqual([]);
    expect(await findCustomers({ select } as never, "")).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
