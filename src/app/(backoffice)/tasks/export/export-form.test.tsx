import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { ExportForm } from "./export-form";

const initial = { from: "2026-10-01", to: "2026-10-31", scope: "completed" as const };

function csvResponse(count: number): Response {
  return new Response("﻿Taaknummer\r\n", {
    status: 200,
    headers: { "Content-Type": "text/csv", "X-Export-Count": String(count) },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("ExportForm", () => {
  it("has labelled fields, the default scope and a GET form to the download route", () => {
    render(<ExportForm initial={initial} problem={null} />);
    expect(screen.getByLabelText("Van", { exact: true })).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Tot en met")).toHaveValue("2026-10-31");
    expect(screen.getByRole("radio", { name: /Enkel nog te factureren/ })).toBeChecked();
    const form = screen.getByRole("form", { name: "Exporteren" });
    expect(form).toHaveAttribute("action", "/tasks/export/download");
    expect(form).toHaveAttribute("method", "get");
  });

  it.each([
    ["missing", "Kies een begin- en einddatum."],
    ["reversed", "De einddatum ligt vóór de begindatum."],
    ["toolong", "De periode is te lang. Kies hoogstens 1 jaar (366 dagen)."],
    ["scope", "Kies welke taken je wilt exporteren."],
  ] as const)("shows the message of problem %s", (problem, message) => {
    render(<ExportForm initial={initial} problem={problem} />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it.each(["reversed", "toolong"] as const)(
    "marks the end day invalid for problem %s (and not the start day)",
    (problem) => {
      render(<ExportForm initial={initial} problem={problem} />);
      expect(screen.getByLabelText("Tot en met")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Van", { exact: true })).not.toHaveAttribute("aria-invalid");
    },
  );

  it("marks no field invalid for an empty period or a first visit", () => {
    const { unmount } = render(<ExportForm initial={initial} problem="empty" />);
    expect(screen.getByLabelText("Tot en met")).not.toHaveAttribute("aria-invalid");
    unmount();
    render(<ExportForm initial={initial} problem={null} />);
    expect(screen.getByLabelText("Tot en met")).not.toHaveAttribute("aria-invalid");
  });

  it("explains an empty period with the dates of the design", () => {
    render(<ExportForm initial={initial} problem="empty" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Er zijn geen afgewerkte taken tussen 01/10/2026 en 31/10/2026. Er is niets te exporteren.",
    );
    expect(screen.getByText("Kies een andere periode.")).toBeInTheDocument();
  });

  it("downloads the file and shows the count and the link to the tab Afgewerkt with the same period", async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse(14));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Het bestand met 14 taken is gedownload (taken-2026-10-01-tot-2026-10-31.csv). Markeer de taken als gefactureerd zodra je ze gefactureerd hebt.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/tasks/export/download?from=2026-10-01&to=2026-10-31&scope=completed",
      expect.anything(),
    );
    expect(screen.getByRole("link", { name: "Naar de afgewerkte taken" })).toHaveAttribute(
      "href",
      "/tasks?status=completed&from=2026-10-01&to=2026-10-31",
    );
  });

  it("says '1 taak' for one task", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(csvResponse(1)));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("met 1 taak is"));
  });

  it("follows a redirect of the route to the export page", async () => {
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "redirected", { value: true });
    Object.defineProperty(response, "url", {
      value: `${window.location.origin}/tasks/export?from=2026-10-01&to=2026-10-31&scope=completed&problem=empty`,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/tasks/export?from=2026-10-01&to=2026-10-31&scope=completed&problem=empty",
      ),
    );
  });

  it("follows a redirect to the login page when the session has run out, without an error", async () => {
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "redirected", { value: true });
    Object.defineProperty(response, "url", { value: `${window.location.origin}/login` });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText(/kon niet worden gemaakt/)).not.toBeInTheDocument();
  });

  it("moves the focus to the message after downloading", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(csvResponse(3)));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it("does not follow a redirect to another site", async () => {
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "redirected", { value: true });
    Object.defineProperty(response, "url", { value: "https://evil.example/tasks/export" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText(/kon niet worden gemaakt/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a message when the server fails or the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText(/kon niet worden gemaakt/)).toBeInTheDocument();
  });

  it("refreshes the page when the session is gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 401 })));
    render(<ExportForm initial={initial} problem={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
