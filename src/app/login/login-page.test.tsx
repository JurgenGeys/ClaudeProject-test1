import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, pathForSignedOutVisitor } = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  pathForSignedOutVisitor: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/auth/login-redirect", () => ({ pathForSignedOutVisitor }));
vi.mock("./actions", () => ({ login: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { LoginContent } from "./login-content";
import LoginPage from "./page";

// The decisions live in the async `LoginContent` (behind <Suspense> in the page); call it directly.
const renderContent = async (searchParams: Record<string, string> = {}) =>
  LoginContent({ searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  vi.resetAllMocks();
  pathForSignedOutVisitor.mockResolvedValue("/login");
});

// Only `searchParams` is used; typegen also requires `params`.
const pageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LoginPage", () => {
  it("shows the company name above the title when it is set", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", "FrisAir Koeltechniek");
    render(<LoginPage {...pageProps} />);
    expect(screen.getByText("FrisAir Koeltechniek")).toBeInTheDocument();
  });

  it("shows no name, and no error, when the company name is empty", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", "");
    const { container } = render(<LoginPage {...pageProps} />);
    expect(screen.getByRole("heading", { name: "Aanmelden bij de planning" })).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
  });

  it("shows no fillable form while it checks the session", () => {
    render(<LoginPage {...pageProps} />);
    expect(screen.getByRole("heading", { name: "Aanmelden bij de planning" })).toBeInTheDocument();
    expect(screen.queryByLabelText("E-mailadres")).not.toBeInTheDocument();
  });

  it("shows the form to a visitor without a session", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    render(await renderContent());
    expect(screen.getByLabelText("E-mailadres")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["technician", "/my-tasks"],
    ["backoffice", "/tasks"],
  ] as const)("sends a signed-in %s to %s", async (role, path) => {
    getAuthState.mockResolvedValue({
      status: "authenticated",
      user: { id: "u1", email: "x@y.be", fullName: "X", role },
    });
    await expect(renderContent()).rejects.toThrow(`NEXT_REDIRECT:${path}`);
  });

  it("sends an invited user without a password to the set password page", async () => {
    getAuthState.mockResolvedValue({
      status: "password-pending",
      user: { id: "u1", email: "x@y.be", fullName: "X" },
    });
    await expect(renderContent()).rejects.toThrow("NEXT_REDIRECT:/set-password?mode=invite");
  });

  it("sends an expired temporary invitation session to the route that ends it", async () => {
    getAuthState.mockResolvedValue({ status: "invite-expired" });
    await expect(renderContent()).rejects.toThrow("NEXT_REDIRECT:/auth/invite-expired");
  });

  it("signs a deactivated user out", async () => {
    getAuthState.mockResolvedValue({ status: "inactive" });
    await expect(renderContent()).rejects.toThrow("NEXT_REDIRECT:/auth/inactive");
  });

  it("clears leftover cookies of a session that no longer exists", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    pathForSignedOutVisitor.mockResolvedValue("/auth/clear-session");
    await expect(renderContent()).rejects.toThrow("NEXT_REDIRECT:/auth/clear-session");
  });

  it("shows the form with a technical message, and no redirect, when Auth is unreachable", async () => {
    getAuthState.mockResolvedValue({ status: "unavailable" });
    render(await renderContent());
    expect(screen.getByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
    expect(screen.getByLabelText("E-mailadres")).toBeInTheDocument();
  });

  it("shows the disabled message after a deactivated user was signed out", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    render(await renderContent({ reason: "disabled" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Je account is uitgeschakeld.");
  });
});
