import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import ConfirmPage from "./page";
import { ConfirmContent } from "./confirm-content";

const content = (searchParams: Record<string, string | undefined>) =>
  ConfirmContent({ searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  verifyOtp.mockReset();
});

describe("/auth/confirm page", () => {
  it("only explains and shows the button: opening the link does not touch the token", async () => {
    render(await content({ token_hash: "abc123", type: "invite" }));
    expect(screen.getByRole("heading", { level: 1, name: "Welkom bij de planning" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Wachtwoord instellen" })).toBeInTheDocument();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("uses its own text for a recovery link (wachtwoord vergeten), without claiming an invitation", async () => {
    render(await content({ token_hash: "abc123", type: "recovery" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Nieuw wachtwoord kiezen" }),
    ).toBeVisible();
    expect(screen.queryByText(/uitgenodigd/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wachtwoord instellen" })).toBeInTheDocument();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("sends the token and the type along with the button, as hidden fields", async () => {
    const { container } = render(await content({ token_hash: "abc123", type: "recovery" }));
    expect(container.querySelector('input[name="token_hash"]')).toHaveValue("abc123");
    expect(container.querySelector('input[name="type"]')).toHaveValue("recovery");
  });

  it.each([{}, { token_hash: "abc" }, { type: "invite" }, { token_hash: "abc", type: "signup" }])(
    "shows the invalid link message instead for %j",
    async (query) => {
      await expect(content(query)).rejects.toThrow(
        "NEXT_REDIRECT:/set-password?mode=invite&error=link",
      );
    },
  );

  it.each([{ type: "recovery" }, { token_hash: "", type: "recovery" }])(
    "shows the reset wording of the invalid link message for a recovery link without a token (%j)",
    async (query) => {
      await expect(content(query)).rejects.toThrow(
        "NEXT_REDIRECT:/set-password?mode=reset&error=link",
      );
    },
  );

  it("keeps the page out of search engines and sends no referrer", () => {
    render(<ConfirmPage {...{ params: Promise.resolve({}), searchParams: Promise.resolve({}) }} />);
    // The metadata export is what Next.js turns into <meta> tags.
    return import("./page").then(({ metadata }) => {
      expect(metadata.referrer).toBe("no-referrer");
      expect(metadata.robots).toEqual({ index: false });
    });
  });
});
