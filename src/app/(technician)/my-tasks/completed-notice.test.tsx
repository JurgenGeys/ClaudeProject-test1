import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompletedNotice } from "./completed-notice";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("CompletedNotice", () => {
  it("says thanks and removes ?completed=1 from the address, keeping other parameters", () => {
    window.history.replaceState(null, "", "/my-tasks?completed=1&tab=done");
    render(<CompletedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Taak afgemeld. Bedankt!");
    expect(window.location.pathname + window.location.search).toBe("/my-tasks?tab=done");
  });
});
