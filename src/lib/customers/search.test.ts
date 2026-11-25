import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { escapeLike, findCustomers } from "./search";

describe("escapeLike", () => {
  it("takes %, _ and the backslash literally", () => {
    expect(escapeLike("50%_off\\x")).toBe("50\\%\\_off\\\\x");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("Bakkerij De Gouden Korst")).toBe("Bakkerij De Gouden Korst");
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
