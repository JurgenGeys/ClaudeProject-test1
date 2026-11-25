import { beforeEach, describe, expect, it, vi } from "vitest";

// Neither module may load for real in a unit test: `server-only` throws outside a server
// bundle and the database client needs DATABASE_URL.
vi.mock("server-only", () => ({}));

// `verifier` checks the password without cookies; `server` writes the session to the cookies.
const signInWithPassword = vi.fn();
const verifierSignOut = vi.fn();
const setSession = vi.fn();
const findProfile = vi.fn();

vi.mock("@/lib/supabase/credentials", () => ({
  createSupabaseCredentialsClient: () => ({
    auth: { signInWithPassword, signOut: verifierSignOut },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { setSession } }),
}));
vi.mock("@/db/client", () => ({
  getDb: () => ({ query: { profiles: { findFirst: findProfile } } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

import { login } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

const session = { access_token: "access-1", refresh_token: "refresh-1" };
const credentials = { email: "kevin@frisair.be", password: "geheim-wachtwoord" };

beforeEach(() => {
  vi.resetAllMocks();
  verifierSignOut.mockResolvedValue({ error: null });
  setSession.mockResolvedValue({ error: null });
});

describe("login: validation", () => {
  it("asks for both fields when the form is empty, without calling Supabase", async () => {
    const state = await login(null, form({ email: "", password: "" }));
    expect(state).toEqual({
      email: "",
      fieldErrors: { email: "Vul je e-mailadres in.", password: "Vul je wachtwoord in." },
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("keeps the typed e-mail address when only the password is missing", async () => {
    const state = await login(null, form({ email: "kevin@frisair.be", password: "" }));
    expect(state).toEqual({
      email: "kevin@frisair.be",
      fieldErrors: { password: "Vul je wachtwoord in." },
    });
  });

  it("refuses absurdly long input without calling Supabase", async () => {
    const state = await login(
      null,
      form({ email: `${"a".repeat(321)}@x.be`, password: "p".repeat(1025) }),
    );
    expect(state?.fieldErrors).toEqual({
      email: "Dit e-mailadres is te lang.",
      password: "Dit wachtwoord is te lang.",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("treats missing form fields like empty ones", async () => {
    const state = await login(null, new FormData());
    expect(state?.fieldErrors).toEqual({
      email: "Vul je e-mailadres in.",
      password: "Vul je wachtwoord in.",
    });
  });
});

describe("login: refused", () => {
  const mismatch = "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.";

  it("gives one message for a wrong password and an unknown address", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const state = await login(null, form(credentials));
    expect(state).toEqual({ email: credentials.email, fieldErrors: {}, formError: mismatch });
    expect(findProfile).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("gives the general message when Supabase reports a blocked user", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("User is banned", 400, "user_banned"),
    });
    const state = await login(null, form(credentials));
    expect(state?.formError).toBe(mismatch);
  });

  it("refuses a deactivated profile with the general message and removes the session again", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" }, session: session },
      error: null,
    });
    findProfile.mockResolvedValue({ id: "u1", role: "technician", isActive: false });
    const state = await login(null, form(credentials));
    expect(state?.formError).toBe(mismatch);
    // The session that was just created is ended, and no cookie was ever written.
    expect(verifierSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(setSession).not.toHaveBeenCalled();
  });

  it("refuses an invited user who has not chosen a password yet, in the same way", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" }, session: session },
      error: null,
    });
    findProfile.mockResolvedValue({
      id: "u1",
      role: "technician",
      isActive: true,
      invitePending: true,
    });
    const state = await login(null, form(credentials));
    expect(state?.formError).toBe(mismatch);
    expect(verifierSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(setSession).not.toHaveBeenCalled();
  });

  it("refuses a user without a profile in the same way", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" }, session: session },
      error: null,
    });
    findProfile.mockResolvedValue(undefined);
    const state = await login(null, form(credentials));
    expect(state?.formError).toBe(mismatch);
    // The session that was just created is ended, and no cookie was ever written.
    expect(verifierSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(setSession).not.toHaveBeenCalled();
  });

  it("shows the technical message when Auth cannot be reached", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    const state = await login(null, form(credentials));
    expect(state?.formError).toBe(
      "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    );
  });

  it("asks to wait when Auth rate-limits (never 'does not match')", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
    });
    const state = await login(null, form(credentials));
    expect(state?.formError).toBe("Te veel pogingen, probeer het over enkele minuten opnieuw.");
  });

  it("shows the technical message when Auth answers with a server error", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Internal error", 500, "unexpected_failure"),
    });
    const state = await login(null, form(credentials));
    expect(state?.formError).toContain("Dat is niet gelukt.");
  });

  it("shows the technical message when something throws, and keeps the address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signInWithPassword.mockRejectedValue(new Error(`boom for ${credentials.email}`));
    const state = await login(null, form(credentials));
    expect(state).toEqual({
      email: credentials.email,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    // Only the error type is logged, never its message (it could contain the address).
    expect(log).toHaveBeenCalledWith("Login failed unexpectedly:", "Error");
    log.mockRestore();
  });
});

describe("login: success", () => {
  it.each([
    ["technician", "/my-tasks"],
    ["backoffice", "/tasks"],
  ] as const)("sends a %s to %s", async (role, path) => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" }, session: session },
      error: null,
    });
    findProfile.mockResolvedValue({ id: "u1", role, isActive: true });
    await expect(login(null, form(credentials))).rejects.toThrow(`NEXT_REDIRECT:${path}`);
    expect(signInWithPassword).toHaveBeenCalledWith(credentials);
    // Only an allowed login writes the session to the cookies.
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access-1",
      refresh_token: "refresh-1",
    });
  });

  it("shows the technical message when the session cannot be stored", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" }, session },
      error: null,
    });
    findProfile.mockResolvedValue({ id: "u1", role: "technician", isActive: true });
    setSession.mockResolvedValue({ error: new Error("nope") });
    const state = await login(null, form(credentials));
    expect(state?.formError).toContain("Dat is niet gelukt.");
  });

  it("trims the e-mail address before signing in", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" }, session: session },
      error: null,
    });
    findProfile.mockResolvedValue({ id: "u1", role: "technician", isActive: true });
    await expect(
      login(null, form({ email: "  kevin@frisair.be  ", password: credentials.password })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(signInWithPassword).toHaveBeenCalledWith(credentials);
  });
});
