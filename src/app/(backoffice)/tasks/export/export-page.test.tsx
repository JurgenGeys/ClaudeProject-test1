import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { checkRoleAccess } = vi.hoisted(() => ({ checkRoleAccess: vi.fn() }));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import ExportPage from "./page";

async function renderPage(params: Record<string, string | string[]> = {}) {
  const ui = await ExportPage({ searchParams: Promise.resolve(params) } as never);
  return render(ui);
}

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: { role: "backoffice" } });
});

describe("the export page (B4)", () => {
  it("checks the backoffice role itself and renders nothing for someone else", async () => {
    checkRoleAccess.mockResolvedValue({ kind: "wrong-role", user: { role: "technician" } });
    const { container } = await renderPage();
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title, the explanation, the example and a link back", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "Exporteren voor de facturatie" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Taken" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("table", { name: /Voorbeeld/ })).toHaveTextContent("Taaknummer");
    expect(screen.getByRole("table", { name: /Voorbeeld/ })).toHaveTextContent("Soort werk");
  });

  it("starts with the previous month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    try {
      await renderPage();
      expect(screen.getByLabelText("Van")).toHaveValue("2026-10-01");
      expect(screen.getByLabelText("Tot en met")).toHaveValue("2026-10-31");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the days that were given and shows the problem of a reversed period", async () => {
    await renderPage({ from: "2026-11-30", to: "2026-11-01" });
    expect(screen.getByLabelText("Van")).toHaveValue("2026-11-30");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "De einddatum moet na de begindatum liggen.",
    );
  });

  it("shows 'empty' only for a valid period, and ignores an unknown problem", async () => {
    await renderPage({ from: "2026-11-01", to: "2026-11-30", problem: "empty" });
    expect(screen.getByRole("alert")).toHaveTextContent("Er is niets te exporteren.");
  });

  it("ignores an unknown problem value", async () => {
    await renderPage({ from: "2026-11-01", to: "2026-11-30", problem: "<b>x</b>" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("checks the 'all' scope when asked", async () => {
    await renderPage({ from: "2026-11-01", to: "2026-11-30", scope: "all" });
    expect(screen.getByRole("radio", { name: /Afgewerkt en gefactureerd/ })).toBeChecked();
  });
});
