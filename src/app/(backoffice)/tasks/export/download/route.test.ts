import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireRole, queryExportRows } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  queryExportRows: vi.fn(),
}));
vi.mock("@/lib/auth/session", async () => {
  class AuthError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { requireRole, AuthError };
});
vi.mock("@/lib/export/query", () => ({ queryExportRows }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

import { AuthError, type AuthErrorCode } from "@/lib/auth/session";
import type { ExportRow } from "@/lib/export/csv";

import { GET } from "./route";

const row: ExportRow = {
  number: 1042,
  scheduledDate: "2026-11-02",
  customerName: "Bakkerij",
  street: "Straat 1",
  postalCode: "2300",
  city: "Turnhout",
  technicianName: "Kevin Wouters",
  workType: "maintenance",
  instructions: "Onderhoud",
  minutes: 90,
  notes: null,
  status: "completed",
};

const call = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/tasks/export/download${query}`));
const GOOD = "?from=2026-11-01&to=2026-11-30&scope=completed";

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ id: "u1", role: "backoffice" });
  queryExportRows.mockResolvedValue([row]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /tasks/export/download", () => {
  it("checks the backoffice role before anything is read", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const response = await call(GOOD);
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(response.status).toBe(403);
    expect(queryExportRows).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", 401],
    ["inactive", 401],
    ["password-pending", 401],
    ["forbidden", 403],
    ["unavailable", 503],
  ])("answers %s with %i and no file", async (code, status) => {
    requireRole.mockRejectedValue(new AuthError(code as AuthErrorCode));
    const response = await call(GOOD);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(queryExportRows).not.toHaveBeenCalled();
  });

  it("returns the file with the right headers, BOM and a safe file name", async () => {
    const response = await call(GOOD);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="taken-2026-11-01-tot-2026-11-30.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-export-count")).toBe("1");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toContain(
      "1042;02/11/2026;Bakkerij;Straat 1, 2300 Turnhout;Kevin Wouters;Onderhoud;Onderhoud;1,5;;Afgewerkt",
    );
  });

  it("passes the validated period and scope to the query", async () => {
    await call("?from=2026-11-01&to=2026-11-30&scope=all");
    expect(queryExportRows).toHaveBeenCalledWith(expect.anything(), {
      from: "2026-11-01",
      to: "2026-11-30",
      scope: "all",
    });
  });

  it("goes back to the export page with 'empty' when there is nothing to export", async () => {
    queryExportRows.mockResolvedValue([]);
    const response = await call(GOOD);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/tasks/export?from=2026-11-01&to=2026-11-30&scope=completed&problem=empty",
    );
  });

  it.each([
    ["", "missing", "/tasks/export?scope=completed&problem=missing"],
    [
      "?from=2026-11-30&to=2026-11-01",
      "reversed",
      "/tasks/export?from=2026-11-30&to=2026-11-01&scope=completed&problem=reversed",
    ],
    [
      "?from=2026-11-01&to=2026-11-30&scope=bad",
      "scope",
      "/tasks/export?from=2026-11-01&to=2026-11-30&scope=completed&problem=scope",
    ],
  ])("redirects an invalid request %j to the export page (%s)", async (query, _problem, path) => {
    const response = await call(query);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`http://localhost:3000${path}`);
    expect(queryExportRows).not.toHaveBeenCalled();
  });

  it("never redirects anywhere else: hostile values do not end up in the address", async () => {
    const response = await call(
      "?from=https://evil.example&to=//evil.example&scope=//evil.example&next=https://evil.example",
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe("/tasks/export");
    expect(location.search).not.toContain("evil");
  });

  it("answers 500 without personal data in the log when the database fails", async () => {
    queryExportRows.mockRejectedValue(new Error("duplicate key for jan@example.com"));
    const response = await call(GOOD);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("jan@example.com");
  });
});
