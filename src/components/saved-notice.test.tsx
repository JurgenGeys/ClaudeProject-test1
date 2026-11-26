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

  it("removes the parameter it was given (?reset), and leaves ?saved alone", () => {
    window.history.replaceState(null, "", "/tasks/1043?reset=1&saved=1");
    render(<SavedNotice param="reset">Taak teruggezet.</SavedNotice>);
    expect(window.location.pathname + window.location.search).toBe("/tasks/1043?saved=1");
  });

  it("leaves an address without ?saved alone", () => {
    window.history.replaceState(null, "", "/tasks/1043");
    render(<SavedNotice>Taak #1043 bewaard.</SavedNotice>);
    expect(window.location.pathname + window.location.search).toBe("/tasks/1043");
  });

  it("removes the parameter that `param` names, and only that one", () => {
    window.history.replaceState(null, "", "/tasks/1043?invoiced=marked&saved=1&x=2");
    render(<SavedNotice param="invoiced">Taak gemarkeerd als gefactureerd.</SavedNotice>);
    expect(screen.getByRole("status")).toHaveTextContent("Taak gemarkeerd als gefactureerd.");
    expect(window.location.pathname + window.location.search).toBe("/tasks/1043?saved=1&x=2");
  });

  it("removes the parameter again when the message changes while the component stays", () => {
    window.history.replaceState(null, "", "/tasks/1043?invoiced=marked");
    const { rerender } = render(<SavedNotice param="invoiced">Eerste</SavedNotice>);
    expect(window.location.search).toBe("");
    window.history.replaceState(null, "", "/tasks/1043?invoiced=unmarked");
    rerender(<SavedNotice param="invoiced">Tweede</SavedNotice>);
    expect(window.location.search).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("Tweede");
  });
});
