import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthState, updateUser, returning, findProfile } = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  updateUser: vi.fn(),
  returning: vi.fn(),
  findProfile: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { updateUser } }),
}));
const set = vi.fn();
vi.mock("@/db/client", () => ({
  getDb: () => ({
    update: () => ({
      set: (...args: unknown[]) => {
        set(...args);
        return { where: () => ({ returning }) };
      },
    }),
    query: { profiles: { findFirst: findProfile } },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { setPassword } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

const pending = {
  status: "password-pending" as const,
  user: { id: "u1", email: "kevin@frisair.be", fullName: "Kevin Wouters" },
};
const good = { password: "een-goed-wachtwoord", confirmPassword: "een-goed-wachtwoord" };
const technical = "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.";
const linkInvalid = "Deze link is niet meer geldig. Vraag kantoor om een nieuwe uitnodiging.";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  getAuthState.mockResolvedValue(pending);
  updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  returning.mockResolvedValue([{ role: "technician" }]);
});

describe("setPassword: who may do it", () => {
  it.each([
    ["without a session", { status: "unauthenticated" }],
    [
      "for a user who already has a password",
      {
        status: "authenticated",
        user: { id: "u1", email: "x@y.be", fullName: "X", role: "technician" },
      },
    ],
    ["for a deactivated user", { status: "inactive" }],
  ])("refuses %s, and does not change a password", async (_name, state) => {
    getAuthState.mockResolvedValue(state);
    expect(await setPassword(null, form(good))).toEqual({
      fieldErrors: {},
      formError: linkInvalid,
    });
    expect(updateUser).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("shows the technical message when Auth cannot be reached", async () => {
    getAuthState.mockResolvedValue({ status: "unavailable" });
    expect(await setPassword(null, form(good))).toEqual({ fieldErrors: {}, formError: technical });
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("setPassword: validation", () => {
  it("refuses a short password without calling Auth", async () => {
    const state = await setPassword(null, form({ password: "kort", confirmPassword: "kort" }));
    expect(state).toEqual({
      fieldErrors: { password: "Je wachtwoord moet minstens 8 tekens hebben." },
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses two passwords that differ", async () => {
    const state = await setPassword(
      null,
      form({ password: "een-goed-wachtwoord", confirmPassword: "een-ander-wachtwoord" }),
    );
    expect(state).toEqual({
      fieldErrors: { confirmPassword: "De twee wachtwoorden zijn niet gelijk." },
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("treats missing form fields like empty ones", async () => {
    const state = await setPassword(null, new FormData());
    expect(state?.fieldErrors.password).toBe("Je wachtwoord moet minstens 8 tekens hebben.");
  });
});

describe("setPassword: success", () => {
  it("sets the password, clears the pending flag and sends a technician to Mijn taken", async () => {
    await expect(setPassword(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/my-tasks");
    expect(updateUser).toHaveBeenCalledWith({ password: "een-goed-wachtwoord" });
    expect(set).toHaveBeenCalledWith({ invitePending: false });
    // Password first, flag second: a failure in between never gives access without a password.
    expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(set.mock.invocationCallOrder[0]);
  });

  it("sends a backoffice user to the task overview", async () => {
    returning.mockResolvedValue([{ role: "backoffice" }]);
    await expect(setPassword(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/tasks");
  });

  it("still succeeds when a second submit already cleared the flag", async () => {
    returning.mockResolvedValue([]);
    findProfile.mockResolvedValue({ role: "technician" });
    await expect(setPassword(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/my-tasks");
  });

  it("accepts `same_password` so a retry after a failed second step works", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("same password", 422, "same_password"),
    });
    await expect(setPassword(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/my-tasks");
    expect(set).toHaveBeenCalledWith({ invitePending: false });
  });
});

describe("setPassword: when something fails", () => {
  it("puts a weak password under the field", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("weak", 422, "weak_password"),
    });
    expect(await setPassword(null, form(good))).toEqual({
      fieldErrors: { password: "Dit wachtwoord is te zwak. Kies een ander wachtwoord." },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("explains that the link is no longer valid when the session has ended", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("session missing", 401, "session_not_found"),
    });
    expect(await setPassword(null, form(good))).toEqual({
      fieldErrors: {},
      formError: linkInvalid,
    });
  });

  it("says so when there were too many attempts", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("slow down", 429, "over_request_rate_limit"),
    });
    expect(await setPassword(null, form(good))).toEqual({
      fieldErrors: {},
      formError: "Te veel pogingen, probeer het over enkele minuten opnieuw.",
    });
  });

  it.each([
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a server error", new AuthApiError("Internal error", 500, "unexpected_failure")],
    ["an unknown error", new AuthApiError("odd", 400, "something_else")],
  ])("gives the technical message after %s and leaves the flag alone", async (_name, error) => {
    updateUser.mockResolvedValue({ data: { user: null }, error });
    expect(await setPassword(null, form(good))).toEqual({ fieldErrors: {}, formError: technical });
    expect(set).not.toHaveBeenCalled();
  });

  it("gives the technical message when the flag cannot be cleared, and logs no password", async () => {
    returning.mockRejectedValue(new Error("db down for een-goed-wachtwoord"));
    expect(await setPassword(null, form(good))).toEqual({ fieldErrors: {}, formError: technical });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("een-goed-wachtwoord");
  });
});
