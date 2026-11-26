import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSearchParams } = vi.hoisted(() => ({ useSearchParams: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams }));

import { InvoicedNotice } from "./invoiced-notice";

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/tasks/1043?invoiced=marked");
});

describe("InvoicedNotice", () => {
  it("confirms a marking", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("invoiced=marked"));
    render(<InvoicedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Taak gemarkeerd als gefactureerd.");
  });

  it("confirms taking the mark off", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("invoiced=unmarked"));
    render(<InvoicedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Markering ongedaan gemaakt. De taak staat weer op Afgewerkt.",
    );
  });

  it.each([["invoiced=1"], ["invoiced=<b>x</b>"], [""]])("shows nothing for %j", (query) => {
    useSearchParams.mockReturnValue(new URLSearchParams(query));
    render(<InvoicedNotice />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows nothing when there are no search parameters at all", () => {
    useSearchParams.mockReturnValue(null);
    render(<InvoicedNotice />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("removes the parameter from the address and keeps the message", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("invoiced=marked"));
    render(<InvoicedNotice />);
    expect(window.location.search).toBe("");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("takes over a new message when the page stays and the parameter comes again", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("invoiced=marked"));
    const { rerender } = render(<InvoicedNotice />);
    useSearchParams.mockReturnValue(new URLSearchParams("invoiced=unmarked"));
    rerender(<InvoicedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Markering ongedaan gemaakt.");
  });
});
