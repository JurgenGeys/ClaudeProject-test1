import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { authFailureMessage } from "./action-errors";
import { AuthError } from "./session";

describe("authFailureMessage", () => {
  it.each([
    ["forbidden", "Je hebt geen toegang om dit te doen."],
    ["unauthenticated", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["password-pending", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["invite-expired", "De link is verlopen. Vraag kantoor om een nieuwe uitnodiging."],
    ["inactive", "Je account is uitgeschakeld. Neem contact op met kantoor."],
    ["unavailable", "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw."],
  ] as const)("%s", (code, message) => {
    expect(authFailureMessage(new AuthError(code))).toBe(message);
  });
});
