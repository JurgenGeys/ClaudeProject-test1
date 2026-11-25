import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Neither module may load for real in a unit test: `server-only` throws outside a server
// bundle and the database client needs DATABASE_URL.
vi.mock("server-only", () => ({}));

const requireRole = vi.fn();
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  // Keep the real AuthError class: the actions recognize it with `instanceof`.
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

// Database: `select().from().where().limit()` finds an existing profile, `insert().values()
// .onConflictDoNothing().returning()` adds one, `query.profiles.findFirst` reads one.
const existingProfiles = vi.fn();
const returning = vi.fn();
const values = vi.fn();
const findFirst = vi.fn();
// `execute` reads `auth.users` (the account with this address, if any).
const execute = vi.fn();
vi.mock("@/db/client", () => ({
  getDb: () => ({
    execute: (...args: unknown[]) => execute(...args),
    select: () => ({ from: () => ({ where: () => ({ limit: existingProfiles }) }) }),
    insert: () => ({
      values: (...args: unknown[]) => {
        values(...args);
        return { onConflictDoNothing: () => ({ returning }) };
      },
    }),
    query: { profiles: { findFirst } },
  }),
}));

const inviteUserByEmail = vi.fn();
const deleteUser = vi.fn();
const updateUserById = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { inviteUserByEmail, deleteUser, updateUserById } },
  }),
}));
const resetPasswordForEmail = vi.fn();
vi.mock("@/lib/supabase/credentials", () => ({
  createSupabaseCredentialsClient: () => ({ auth: { resetPasswordForEmail } }),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { AuthError } from "@/lib/auth/session";

import { inviteTechnician, resendInvite } from "./actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const sofie = {
  id: "s1",
  email: "sofie@frisair.be",
  fullName: "Sofie Peeters",
  role: "backoffice",
};
const valid = { fullName: "Kevin Wouters", email: "Kevin.Wouters@FrisAir.be" };
const authUserId = "11111111-1111-4111-8111-111111111111";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  requireRole.mockResolvedValue(sofie);
  existingProfiles.mockResolvedValue([]);
  inviteUserByEmail.mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  updateUserById.mockResolvedValue({ error: null });
  resetPasswordForEmail.mockResolvedValue({ error: null });
  // No Auth account with this address yet.
  execute.mockResolvedValue([]);
  returning.mockResolvedValue([{ id: authUserId }]);
});

describe("inviteTechnician: who may do it", () => {
  it("requires the backoffice role and does nothing else for a technician", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    const state = await inviteTechnician(null, form(valid));
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(state).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(existingProfiles).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["password-pending", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["inactive", "Je account is uitgeschakeld. Neem contact op met kantoor."],
  ] as const)("refuses a caller who is %s", async (code, formError) => {
    requireRole.mockRejectedValue(new AuthError(code));
    expect(await inviteTechnician(null, form(valid))).toMatchObject({ ok: false, formError });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(inviteTechnician(null, form(valid))).rejects.toThrow("boom");
  });
});

describe("inviteTechnician: validation", () => {
  it("reports both fields of an empty form without calling Auth or the database", async () => {
    const state = await inviteTechnician(null, form({ fullName: "", email: "" }));
    expect(state).toEqual({
      ok: false,
      fieldErrors: { fullName: "Vul de naam in.", email: "Vul een geldig e-mailadres in." },
      values: { fullName: "", email: "" },
    });
    expect(existingProfiles).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("keeps what was typed so the dialog can show it again", async () => {
    const state = await inviteTechnician(null, form({ fullName: "Kevin", email: "geen-adres" }));
    expect(state).toEqual({
      ok: false,
      fieldErrors: { email: "Vul een geldig e-mailadres in." },
      values: { fullName: "Kevin", email: "geen-adres" },
    });
  });

  it("treats missing form fields like empty ones", async () => {
    const state = await inviteTechnician(null, new FormData());
    expect(state).toMatchObject({ ok: false, fieldErrors: { fullName: "Vul de naam in." } });
  });
});

describe("inviteTechnician: success", () => {
  it("invites by e-mail, then saves a technician profile that waits for its password", async () => {
    const state = await inviteTechnician(null, form(valid));

    expect(state).toEqual({
      ok: true,
      message:
        "Uitnodiging verstuurd naar kevin.wouters@frisair.be. De technieker krijgt een mail met een link om een wachtwoord te kiezen.",
    });
    // Normalized address, and the redirect URL comes from SITE_URL.
    expect(inviteUserByEmail).toHaveBeenCalledWith("kevin.wouters@frisair.be", {
      redirectTo: "http://localhost:3000/auth/confirm",
    });
    expect(values).toHaveBeenCalledWith({
      id: authUserId,
      fullName: "Kevin Wouters",
      email: "kevin.wouters@frisair.be",
      role: "technician",
      invitePending: true,
    });
    // The new Auth user is marked as created by this application (only the admin API can do that).
    expect(updateUserById).toHaveBeenCalledWith(authUserId, {
      app_metadata: { invited_by_app: true },
    });
    expect(updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      values.mock.invocationCallOrder[0],
    );
    expect(deleteUser).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("never takes the redirect URL from the request: a different SITE_URL changes the link", async () => {
    vi.stubEnv("SITE_URL", "https://planning.frisair.be/");
    await inviteTechnician(null, form(valid));
    expect(inviteUserByEmail).toHaveBeenCalledWith(expect.any(String), {
      redirectTo: "https://planning.frisair.be/auth/confirm",
    });
  });

  it("does not put an address in the logs", async () => {
    await inviteTechnician(null, form(valid));
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("inviteTechnician: duplicate e-mail address", () => {
  const duplicate = {
    ok: false,
    fieldErrors: { email: "Er bestaat al een gebruiker met dit e-mailadres." },
    values: { fullName: "Kevin Wouters", email: "kevin.wouters@frisair.be" },
  };

  it("refuses an address that already has a profile, whatever its role, and sends nothing", async () => {
    existingProfiles.mockResolvedValue([{ id: "x" }]);
    expect(await inviteTechnician(null, form(valid))).toEqual(duplicate);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it("refuses the address of a backoffice user in the same way (no technician with that address)", async () => {
    existingProfiles.mockResolvedValue([{ id: sofie.id }]);
    const state = await inviteTechnician(null, form({ fullName: "Sofie", email: sofie.email }));
    expect(state).toMatchObject({
      ok: false,
      fieldErrors: { email: "Er bestaat al een gebruiker met dit e-mailadres." },
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it.each(["email_exists", "user_already_exists"])(
    "refuses an address that Auth already knows (%s), without creating a profile for it",
    async (code) => {
      inviteUserByEmail.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError("already registered", 422, code),
      });
      expect(await inviteTechnician(null, form(valid))).toEqual(duplicate);
      expect(values).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    },
  );

  it("treats a lost race (the profile appeared in the meantime) as a duplicate and removes nothing", async () => {
    returning.mockResolvedValue([]);
    expect(await inviteTechnician(null, form(valid))).toEqual(duplicate);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("inviteTechnician: an Auth account without a profile", () => {
  it("refuses an account that this application did not create, without a mail, a role or a removal", async () => {
    // For example somebody who registered by themselves while sign-up was still open.
    execute.mockResolvedValue([{ id: authUserId, invited_by_app: null }]);
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      fieldErrors: { email: "Er bestaat al een gebruiker met dit e-mailadres." },
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("reuses an account that this application created earlier (interrupted invitation) and heals it", async () => {
    execute.mockResolvedValue([{ id: authUserId, invited_by_app: "true" }]);
    expect(await inviteTechnician(null, form(valid))).toMatchObject({ ok: true });
    expect(inviteUserByEmail).toHaveBeenCalled();
    // Already marked: nothing to set again.
    expect(updateUserById).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ id: authUserId }));
  });

  it("adds nothing when Auth answers with another account than the one that was found", async () => {
    execute.mockResolvedValue([
      { id: "99999999-9999-4999-8999-999999999999", invited_by_app: "true" },
    ]);
    expect(await inviteTechnician(null, form(valid))).toMatchObject({ ok: false });
    expect(values).not.toHaveBeenCalled();
  });

  it("removes the new Auth user again when it cannot be marked", async () => {
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(deleteUser).toHaveBeenCalledWith(authUserId);
    expect(values).not.toHaveBeenCalled();
  });
});

describe("inviteTechnician: when something fails", () => {
  const technical = "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.";

  it("removes the Auth user again when the profile cannot be saved, so nothing is left half done", async () => {
    returning.mockRejectedValue(
      Object.assign(new Error("db down for kevin@x.be"), { code: "08006" }),
    );
    const state = await inviteTechnician(null, form(valid));
    expect(state).toMatchObject({ ok: false, formError: technical });
    expect(deleteUser).toHaveBeenCalledWith(authUserId);
    expect(revalidatePath).not.toHaveBeenCalled();
    // The log holds the kind of error, never its message (which could hold the address).
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("kevin");
  });

  it("still reports the problem when the clean-up fails as well", async () => {
    returning.mockRejectedValue(new Error("db down"));
    deleteUser.mockResolvedValue({ error: new AuthApiError("nope", 500, "unexpected_failure") });
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      formError: technical,
    });
  });

  it("says so when too many mails were sent", async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("rate limit", 429, "over_email_send_rate_limit"),
    });
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      formError: "Er zijn te veel mails verstuurd. Probeer het over enkele minuten opnieuw.",
    });
    expect(values).not.toHaveBeenCalled();
  });

  it("puts an address that Auth refuses as invalid under the e-mail field", async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("invalid", 400, "email_address_invalid"),
    });
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      fieldErrors: { email: "Vul een geldig e-mailadres in." },
    });
  });

  it("gives the technical message for any other Auth error and creates no profile", async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(values).not.toHaveBeenCalled();
  });

  it("gives the technical message, and sends nothing, when SITE_URL is not set", async () => {
    vi.stubEnv("SITE_URL", "");
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Inviting a technician failed unexpectedly:",
      expect.stringContaining("SITE_URL is not set"),
    );
  });
});

describe("resendInvite", () => {
  const pending = {
    id: authUserId,
    email: "yana@frisair.be",
    fullName: "Yana Willems",
    role: "technician",
    isActive: true,
    invitePending: true,
  };

  beforeEach(() => {
    findFirst.mockResolvedValue(pending);
  });

  it("requires the backoffice role", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      ok: false,
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(findFirst).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("sends the invitation again to the address in the database, not to one from the form", async () => {
    const state = await resendInvite(null, form({ id: authUserId, email: "boef@evil.example" }));
    expect(state).toEqual({
      ok: true,
      message: "Uitnodiging opnieuw verstuurd naar yana@frisair.be.",
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith("yana@frisair.be", {
      redirectTo: "http://localhost:3000/auth/confirm",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it.each(["", "niet-een-uuid", "1 or 1=1"])(
    "refuses the id %j without touching anything",
    async (id) => {
      expect(await resendInvite(null, form({ id }))).toMatchObject({
        ok: false,
        formError: "Deze technieker bestaat niet (meer). Laad de pagina opnieuw.",
      });
      expect(findFirst).not.toHaveBeenCalled();
      expect(inviteUserByEmail).not.toHaveBeenCalled();
    },
  );

  it("refuses an unknown id, and the id of a backoffice user", async () => {
    findFirst.mockResolvedValue(undefined);
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({ ok: false });
    findFirst.mockResolvedValue({ ...pending, role: "backoffice" });
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      ok: false,
      formError: "Deze technieker bestaat niet (meer). Laad de pagina opnieuw.",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("refuses a technician who already chose a password", async () => {
    findFirst.mockResolvedValue({ ...pending, invitePending: false });
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      ok: false,
      formError: "Yana Willems heeft al een wachtwoord gekozen. Laad de pagina opnieuw.",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("refuses a technician who is switched off", async () => {
    findFirst.mockResolvedValue({ ...pending, isActive: false });
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      ok: false,
      formError: "Yana Willems is uitgeschakeld. Een uitnodiging versturen kan niet.",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("sends a recovery link when the first link was already opened (the address is confirmed)", async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("already registered", 422, "email_exists"),
    });
    const state = await resendInvite(null, form({ id: authUserId }));
    expect(state).toEqual({
      ok: true,
      message: "Uitnodiging opnieuw verstuurd naar yana@frisair.be.",
    });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("yana@frisair.be", {
      redirectTo: "http://localhost:3000/auth/confirm",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("does not use the recovery mail when the invitation could be sent", async () => {
    await resendInvite(null, form({ id: authUserId }));
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("reports problems of the recovery mail too, and never mentions a password reminder", async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("already registered", 422, "email_exists"),
    });
    resetPasswordForEmail.mockResolvedValue({
      error: new AuthApiError("slow down", 429, "over_email_send_rate_limit"),
    });
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      ok: false,
      formError: "Er zijn te veel mails verstuurd. Probeer het over enkele minuten opnieuw.",
    });
    resetPasswordForEmail.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    const state = await resendInvite(null, form({ id: authUserId }));
    expect(state).toMatchObject({ ok: false });
    expect(JSON.stringify(state)).not.toMatch(/vergeten/i);
  });

  it("says so when too many mails were sent, and gives the technical message otherwise", async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("rate limit", 429, "over_email_send_rate_limit"),
    });
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      formError: "Er zijn te veel mails verstuurd. Probeer het over enkele minuten opnieuw.",
    });
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
  });

  it("gives the technical message when the database fails", async () => {
    findFirst.mockRejectedValue(new Error("db down"));
    expect(await resendInvite(null, form({ id: authUserId }))).toMatchObject({
      ok: false,
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
  });
});
