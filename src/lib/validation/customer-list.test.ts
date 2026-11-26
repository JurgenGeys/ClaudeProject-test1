import { describe, expect, it } from "vitest";

import { customerListHref, parseCustomerId, parseCustomerListParams } from "./customer-list";

describe("parseCustomerListParams", () => {
  it("defaults to no search text and the first page", () => {
    expect(parseCustomerListParams({})).toEqual({ q: "", page: 1 });
  });

  it("reads the trimmed search text and the page", () => {
    expect(parseCustomerListParams({ q: "  turnhout ", page: "3" })).toEqual({
      q: "turnhout",
      page: 3,
    });
  });

  it.each(["0", "-1", "1e3", "+2", " 2", "abc", "", "1234567"])(
    "ignores the invalid page %j",
    (page) => {
      expect(parseCustomerListParams({ page }).page).toBe(1);
    },
  );

  it("ignores a repeated parameter and a search text that is too long", () => {
    expect(parseCustomerListParams({ q: ["a", "b"], page: ["2", "3"] })).toEqual({
      q: "",
      page: 1,
    });
    expect(parseCustomerListParams({ q: "x".repeat(101) }).q).toBe("");
    expect(parseCustomerListParams({ q: "x".repeat(100) }).q).toBe("x".repeat(100));
  });
});

describe("customerListHref", () => {
  it("leaves the defaults out", () => {
    expect(customerListHref({})).toBe("/customers");
    expect(customerListHref({ q: "", page: 1 })).toBe("/customers");
  });

  it("keeps the search text (encoded) and the page", () => {
    expect(customerListHref({ q: "De Smedt & zn", page: 2 })).toBe(
      "/customers?q=De+Smedt+%26+zn&page=2",
    );
  });
});

describe("parseCustomerId", () => {
  it("accepts a UUID and nothing else", () => {
    const id = "6f1c1c7e-4f55-4c3b-9d33-0a5b0f2a9c11";
    expect(parseCustomerId(id)).toBe(id);
    for (const value of ["", "new", "1042", `${id}x`, "' or 1=1 --"]) {
      expect(parseCustomerId(value)).toBeNull();
    }
  });
});
