import { describe, expect, it } from "vitest";

import { myTasksHref, parseMyTasksTab } from "./my-tasks";

describe("parseMyTasksTab", () => {
  it("selects the finished tab only for exactly 'done'", () => {
    expect(parseMyTasksTab("done")).toBe("done");
  });

  it.each([[undefined], [""], ["todo"], ["DONE"], ["done "], ["completed"], [["done", "done"]]])(
    "falls back to 'Te doen' for %j",
    (value) => {
      expect(parseMyTasksTab(value)).toBe("todo");
    },
  );
});

describe("myTasksHref", () => {
  it("leaves the default tab out of the address", () => {
    expect(myTasksHref("todo")).toBe("/my-tasks");
    expect(myTasksHref("done")).toBe("/my-tasks?tab=done");
  });
});
