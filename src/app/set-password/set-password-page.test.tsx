import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState } = vi.hoisted(() => ({ getAuthState: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("./actions", () => ({ setPassword: vi.fn() }));
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import SetPasswordPage from "./page";
import { SetPasswordContent } from "./set-password-content";

// The decisions live in the async `SetPasswordContent` (behind <Suspense> in the page).
const renderContent = async (searchParams: Record<string, string> = {}) =>
  SetPasswordContent({ searchParams: Promise.resolve(searchParams) });

const pageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SetPasswordPage", () => {
  it("shows the company name and no fillable form while it checks the session", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_NAME", "FrisAir Koeltechniek");
    render(<SetPasswordPage {...pageProps} />);
    expect(screen.getByText("FrisAir Koeltechniek")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nieuw wachtwoord")).not.toBeInTheDocument();
  });
});

describe("SetPasswordContent", () => {
  it("welcomes an invited user by first name and shows the form", async () => {
    getAuthState.mockResolvedValue({
      status: "password-pending",
      user: { id: "u1", email: "kevin@frisair.be", fullName: "Kevin Wouters" },
    });
    render(await renderContent({ mode: "invite" }));
    expect(screen.getByRole("heading", { level: 1, name: "Welkom, Kevin" })).toBeInTheDocument();
    expect(
      screen.getByText("Kies een wachtwoord om de planning te gebruiken."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nieuw wachtwoord")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers 'Annuleren', which signs the temporary session out", async () => {
    getAuthState.mockResolvedValue({
      status: "password-pending",
      user: { id: "u1", email: "kevin@frisair.be", fullName: "Kevin Wouters" },
    });
    render(await renderContent({ mode: "invite" }));
    expect(screen.getByRole("button", { name: "Annuleren" })).toBeInTheDocument();
  });

  it("sends a session that is older than 24 hours to the route that ends it", async () => {
    getAuthState.mockResolvedValue({ status: "invite-expired" });
    await expect(renderContent({ mode: "invite" })).rejects.toThrow(
      "NEXT_REDIRECT:/auth/invite-expired",
    );
  });

  it("shows the expiry message, and no form, after that session was ended", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    render(await renderContent({ mode: "invite", error: "expired" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "De link is verlopen. Vraag kantoor om een nieuwe uitnodiging.",
    );
    expect(screen.queryByLabelText("Nieuw wachtwoord")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuleren" })).not.toBeInTheDocument();
  });

  it("shows the invalid-link message, and no form, to a visitor without a session", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    render(await renderContent({ mode: "invite", error: "link" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deze link is niet meer geldig.Vraag kantoor om een nieuwe uitnodiging.",
    );
    expect(screen.queryByLabelText("Nieuw wachtwoord")).not.toBeInTheDocument();
  });

  it("shows the same message when the page is opened directly, without a link", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    render(await renderContent());
    expect(screen.getByRole("alert")).toHaveTextContent("Deze link is niet meer geldig.");
    expect(screen.queryByLabelText("Nieuw wachtwoord")).not.toBeInTheDocument();
  });

  it("does not claim the link is invalid when the link could not be checked", async () => {
    getAuthState.mockResolvedValue({ status: "unauthenticated" });
    render(await renderContent({ mode: "invite", error: "unavailable" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
    expect(screen.queryByText(/niet meer geldig/)).not.toBeInTheDocument();
  });

  it("shows the technical message when Auth cannot be reached", async () => {
    getAuthState.mockResolvedValue({ status: "unavailable" });
    render(await renderContent({ mode: "invite" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
  });

  it.each([
    ["technician", "/my-tasks"],
    ["backoffice", "/tasks"],
  ] as const)(
    "sends a user who already has a password (%s) to their start page",
    async (role, path) => {
      getAuthState.mockResolvedValue({
        status: "authenticated",
        user: { id: "u1", email: "x@y.be", fullName: "X", role },
      });
      await expect(renderContent({ mode: "invite" })).rejects.toThrow(`NEXT_REDIRECT:${path}`);
    },
  );

  it("signs a deactivated user out", async () => {
    getAuthState.mockResolvedValue({ status: "inactive" });
    await expect(renderContent({ mode: "invite" })).rejects.toThrow("NEXT_REDIRECT:/auth/inactive");
  });
});
