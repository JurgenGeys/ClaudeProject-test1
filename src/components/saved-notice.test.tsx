import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SavedNotice } from "./saved-notice";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("SavedNotice", () => {
  it("shows the message as a status and removes ?saved from the address, keeping other parameters", () => {
    window.history.replaceState(null, "", "/tasks/1043?saved=1&x=2");
    render(<SavedNotice>Taak #1043 bewaard.</SavedNotice>);
    expect(screen.getByRole("status")).toHaveTextContent("Taak #1043 bewaard.");
    expect(window.location.pathname + window.location.search).toBe("/tasks/1043?x=2");
  });

  it("leaves an address without ?saved alone", () => {
    window.history.replaceState(null, "", "/tasks/1043");
    render(<SavedNotice>Taak #1043 bewaard.</SavedNotice>);
    expect(window.location.pathname + window.location.search).toBe("/tasks/1043");
  });
});
