import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, requestPasswordReset } = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  requestPasswordReset: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("./actions", () => ({ requestPasswordReset }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import ForgotPasswordPage from "./page";
import { ForgotPasswordContent } from "./forgot-password-content";
import { ForgotPasswordForm } from "./forgot-password-form";

const SENT =
  "Als dit e-mailadres bij ons gekend is, krijg je binnen enkele minuten een mail met een link om een nieuw wachtwoord te kiezen.";

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ForgotPasswordPage", () => {
  it("shows the heading and the company name, and no fillable form while it checks the session", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", "FrisAir Koeltechniek");
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Wachtwoord vergeten" })).toBeVisible();
    expect(screen.getByText("FrisAir Koeltechniek")).toBeInTheDocument();
    expect(screen.queryByLabelText("E-mailadres")).not.toBeInTheDocument();
  });
});

describe("ForgotPasswordContent", () => {
  it.each([
    ["no session", { status: "unauthenticated" }],
    ["an unreachable Auth", { status: "unavailable" }],
  ])("shows the form for %s", async (_name, state) => {
    getAuthState.mockResolvedValue(state);
    render(await ForgotPasswordContent());
    expect(screen.getByLabelText("E-mailadres")).toBeInTheDocument();
  });

  it.each([
    ["technician", "/my-tasks"],
    ["backoffice", "/tasks"],
  ] as const)("sends a signed-in %s to their start page", async (role, path) => {
    getAuthState.mockResolvedValue({
      status: "authenticated",
      user: { id: "u1", email: "x@y.be", fullName: "X", role },
    });
    await expect(ForgotPasswordContent()).rejects.toThrow(`NEXT_REDIRECT:${path}`);
  });

  it.each([
    [{ status: "inactive" }, "/auth/inactive"],
    [{ status: "invite-expired" }, "/auth/invite-expired"],
    [{ status: "reset-expired" }, "/auth/reset-expired"],
    [
      { status: "password-pending", user: { id: "u1", email: "x@y.be", fullName: "X" } },
      "/set-password?mode=invite",
    ],
    [
      {
        status: "reset-pending",
        user: { id: "u1", email: "x@y.be", fullName: "X", role: "backoffice" },
      },
      "/set-password?mode=reset",
    ],
  ])("sends %j on to %s", async (state, path) => {
    getAuthState.mockResolvedValue(state);
    await expect(ForgotPasswordContent()).rejects.toThrow(`NEXT_REDIRECT:${path}`);
  });
});

describe("ForgotPasswordForm", () => {
  it("has a labelled address field, the button and a link back to the login page", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText("E-mailadres")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Stuur mij een link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar aanmelden" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks the form as hydrated, for the end-to-end tests", () => {
    const { container } = render(<ForgotPasswordForm />);
    expect(container.querySelector('form[data-hydrated="true"]')).not.toBeNull();
  });

  it("replaces the form by the one confirmation message after sending", async () => {
    requestPasswordReset.mockResolvedValue({ sent: true });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "x@y.be" } });
    fireEvent.submit(screen.getByRole("button", { name: "Stuur mij een link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(SENT));
    expect(screen.queryByLabelText("E-mailadres")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar aanmelden" })).toBeInTheDocument();
  });

  it("shows the field error under the field, keeps what was typed and moves the focus", async () => {
    requestPasswordReset.mockResolvedValue({
      sent: false,
      email: "geen-adres",
      fieldErrors: { email: "Vul een geldig e-mailadres in." },
    });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "geen-adres" } });
    fireEvent.submit(screen.getByRole("button", { name: "Stuur mij een link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Vul een geldig e-mailadres in.");
    expect(screen.getByLabelText("E-mailadres")).toHaveAccessibleDescription(
      "Vul een geldig e-mailadres in.",
    );
    expect(screen.getByLabelText("E-mailadres")).toHaveValue("geen-adres");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
