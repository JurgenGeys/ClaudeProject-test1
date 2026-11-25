import { describe, expect, it } from "vitest";

import { parseTaskNumber } from "./task-number";

describe("parseTaskNumber", () => {
  it.each([
    ["1001", 1001],
    ["1", 1],
    ["1043", 1043],
    ["999999999", 999999999],
  ])("reads %j as %i", (value, expected) => {
    expect(parseTaskNumber(value)).toBe(expected);
  });

  it.each([
    [""],
    ["0"],
    ["01043"],
    ["-5"],
    ["+5"],
    ["1e3"],
    ["1.5"],
    [" 1043"],
    ["1043 "],
    ["1043\n"],
    ["abc"],
    ["<b>1</b>"],
    ["1000000000"],
    ["2147483648"],
    ["٣"],
    [undefined],
    [null],
    [1043],
    [["1043"]],
  ])("refuses %j", (value) => {
    expect(parseTaskNumber(value)).toBeNull();
  });
});
