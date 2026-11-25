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
// `transaction` hands a stand-in transaction to the callback; the rule itself is tested in
// `deactivate.db.test.ts` against a real database.
const transaction = vi.fn();
const tx = { marker: "tx" };
const revokeInvitationProfile = vi.fn();
vi.mock("@/lib/technicians/revoke", () => ({
  revokeInvitationProfile: (...args: unknown[]) => revokeInvitationProfile(...args),
}));
const deactivateTechnicianProfile = vi.fn();
vi.mock("@/lib/technicians/deactivate", () => ({
  deactivateTechnicianProfile: (...args: unknown[]) => deactivateTechnicianProfile(...args),
}));
const reactivateTechnicianProfile = vi.fn();
vi.mock("@/lib/technicians/reactivate", () => ({
  reactivateTechnicianProfile: (...args: unknown[]) => reactivateTechnicianProfile(...args),
}));
vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
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
import { AUTH_BAN_TIMEOUT_MS } from "@/lib/technicians/ban";

import {
  deactivateTechnician,
  inviteTechnician,
  reactivateTechnician,
  resendInvite,
  revokeInvitation,
} from "./actions";

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
  // Like Drizzle: run the callback, roll back (here: reject) when it throws.
  transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tx));
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
    // Already marked: nothing to set again; only a block left by a revoked invitation is lifted.
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(authUserId, { ban_duration: "none" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ id: authUserId }));
  });

  it("refuses as a duplicate when the account has a profile under another address, and keeps its block", async () => {
    // The e-mail address of the Auth account was changed by the user: no profile with this
    // address, but the account itself belongs to a (maybe switched-off) technician.
    execute.mockResolvedValue([{ id: authUserId, invited_by_app: "true" }]);
    existingProfiles.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: authUserId }]);
    expect(await inviteTechnician(null, form(valid))).toMatchObject({
      ok: false,
      fieldErrors: { email: "Er bestaat al een gebruiker met dit e-mailadres." },
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
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

describe("deactivateTechnician", () => {
  const id = authUserId;

  it("requires the backoffice role and touches nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(transaction).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["inactive", "Je account is uitgeschakeld. Neem contact op met kantoor."],
    ["reset-pending", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
  ] as const)("refuses a caller who is %s", async (code, formError) => {
    requireRole.mockRejectedValue(new AuthError(code));
    expect(await deactivateTechnician(null, form({ id }))).toMatchObject({ ok: false, formError });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(deactivateTechnician(null, form({ id }))).rejects.toThrow("boom");
  });

  it.each(["", "not-a-uuid", "x"])("refuses the id %j without a database call", async (bad) => {
    expect(await deactivateTechnician(null, form({ id: bad }))).toMatchObject({
      ok: false,
      formError: "Deze technieker bestaat niet (meer). Laad de pagina opnieuw.",
    });
    expect(await deactivateTechnician(null, new FormData())).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("switches the technician off, blocks the Auth account in the same transaction and refreshes the list", async () => {
    deactivateTechnicianProfile.mockResolvedValue({ kind: "deactivated", fullName: "Bram Claes" });
    // The block is set while the transaction callback still runs, so a failure can roll back.
    let blockedInsideTransaction = false;
    updateUserById.mockImplementation(async () => {
      blockedInsideTransaction = transaction.mock.calls.length === 1;
      return { error: null };
    });

    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: true,
      message: "Bram Claes is uitgeschakeld. Zijn afgewerkte taken en uren blijven bewaard.",
    });
    expect(deactivateTechnicianProfile).toHaveBeenCalledWith(tx, id);
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "87600h" });
    expect(blockedInsideTransaction).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("takes the id from the form only and ignores any other field", async () => {
    deactivateTechnicianProfile.mockResolvedValue({ kind: "deactivated", fullName: "Bram Claes" });
    await deactivateTechnician(null, form({ id, email: "evil@example.com", fullName: "Evil" }));
    expect(deactivateTechnicianProfile).toHaveBeenCalledWith(tx, id);
    expect(updateUserById).toHaveBeenCalledWith(id, { ban_duration: "87600h" });
  });

  it("refuses with the number of open tasks and does not block the Auth account", async () => {
    deactivateTechnicianProfile.mockResolvedValue({
      kind: "open-tasks",
      fullName: "Kevin Wouters",
      openTasks: 6,
    });
    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError:
        "Uitschakelen kan nog niet. Kevin Wouters heeft nog taken die niet afgewerkt zijn (6). Wijs die eerst aan een andere technieker toe.",
      openTasks: 6,
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not-found" }, "Deze technieker bestaat niet (meer). Laad de pagina opnieuw."],
    [
      { kind: "invited", fullName: "Yana Willems" },
      "Yana Willems heeft de uitnodiging nog niet aanvaard en kan daarom niet uitgeschakeld worden.",
    ],
  ])("refuses %j and changes nothing", async (outcome, formError) => {
    deactivateTechnicianProfile.mockResolvedValue(outcome);
    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError,
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rolls back and reports a technical problem when the Auth block fails", async () => {
    deactivateTechnicianProfile.mockResolvedValue({ kind: "deactivated", fullName: "Bram Claes" });
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    // The transaction callback throws, so (as in Drizzle) the transaction rejects: no commit.
    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(updateUserById).toHaveBeenCalledTimes(1); // No unblock: nothing was blocked.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lifts the block again when the commit fails after the account was blocked", async () => {
    deactivateTechnicianProfile.mockResolvedValue({ kind: "deactivated", fullName: "Bram Claes" });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback(tx);
      throw new Error("commit failed");
    });
    expect(await deactivateTechnician(null, form({ id }))).toMatchObject({ ok: false });
    expect(updateUserById).toHaveBeenNthCalledWith(1, id, { ban_duration: "87600h" });
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "none" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("gives the technical message when the database fails, without personal data in the log", async () => {
    transaction.mockRejectedValue(new Error("db down for kevin@frisair.be"));
    expect(await deactivateTechnician(null, form({ id }))).toMatchObject({
      ok: false,
      formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("kevin@frisair.be");
  });

  it("logs the technician id (no name or e-mail) when the block cannot be lifted again", async () => {
    deactivateTechnicianProfile.mockResolvedValue({ kind: "deactivated", fullName: "Bram Claes" });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback(tx);
      throw new Error("commit failed");
    });
    updateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new AuthApiError("boom", 500, "unexpected_failure") });
    expect(await deactivateTechnician(null, form({ id }))).toMatchObject({ ok: false });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain(id);
    expect(logged).not.toContain("Bram");
  });

  it("sets the block again when the technician turns out to be switched off already (ambiguous commit)", async () => {
    deactivateTechnicianProfile.mockResolvedValue({
      kind: "already-disabled",
      fullName: "Bram Claes",
    });
    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Bram Claes is al uitgeschakeld. Laad de pagina opnieuw.",
    });
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "87600h" });
  });

  it("repairs the block inside the transaction, while the row lock is still held", async () => {
    deactivateTechnicianProfile.mockResolvedValue({
      kind: "already-disabled",
      fullName: "Bram Claes",
    });
    let transactionOpen = false;
    let repairedInside = false;
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(tx);
      } finally {
        transactionOpen = false;
      }
    });
    updateUserById.mockImplementation(async () => {
      repairedInside = transactionOpen;
      return { error: null };
    });
    await deactivateTechnician(null, form({ id }));
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "87600h" });
    expect(repairedInside).toBe(true);
  });

  it("only logs when repairing the block fails: no rollback, no extra attempts", async () => {
    deactivateTechnicianProfile.mockResolvedValue({
      kind: "already-disabled",
      fullName: "Bram Claes",
    });
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    await deactivateTechnician(null, form({ id }));
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).toContain(id);
  });

  it("gives the same message and logs the id when repairing the block fails", async () => {
    deactivateTechnicianProfile.mockResolvedValue({
      kind: "already-disabled",
      fullName: "Bram Claes",
    });
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await deactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Bram Claes is al uitgeschakeld. Laad de pagina opnieuw.",
    });
    expect(JSON.stringify(consoleError.mock.calls)).toContain(id);
  });

  it("rolls back and undoes a possibly applied block when Auth does not answer in time", async () => {
    deactivateTechnicianProfile.mockResolvedValue({ kind: "deactivated", fullName: "Bram Claes" });
    vi.useFakeTimers();
    try {
      updateUserById.mockReturnValueOnce(new Promise(() => {}));
      updateUserById.mockResolvedValueOnce({ error: null });
      const result = deactivateTechnician(null, form({ id }));
      await vi.advanceTimersByTimeAsync(AUTH_BAN_TIMEOUT_MS);
      expect(await result).toMatchObject({
        ok: false,
        formError: "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.",
      });
    } finally {
      vi.useRealTimers();
    }
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "none" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("reactivateTechnician", () => {
  const id = authUserId;
  const technical = "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.";

  it("requires the backoffice role and touches nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    expect(await reactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(transaction).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
    ["inactive", "Je account is uitgeschakeld. Neem contact op met kantoor."],
    ["reset-pending", "Je bent niet (meer) aangemeld. Meld je opnieuw aan."],
  ] as const)("refuses a caller who is %s", async (code, formError) => {
    requireRole.mockRejectedValue(new AuthError(code));
    expect(await reactivateTechnician(null, form({ id }))).toMatchObject({ ok: false, formError });
    expect(transaction).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(reactivateTechnician(null, form({ id }))).rejects.toThrow("boom");
  });

  it.each(["", "not-a-uuid", "x"])("refuses the id %j without a database call", async (bad) => {
    expect(await reactivateTechnician(null, form({ id: bad }))).toMatchObject({
      ok: false,
      formError: "Deze technieker bestaat niet (meer). Laad de pagina opnieuw.",
    });
    expect(await reactivateTechnician(null, new FormData())).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("switches the technician on, lifts the block in the same transaction and refreshes the list", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    // The block is lifted while the transaction callback still runs, so a failure can roll back.
    let liftedInsideTransaction = false;
    updateUserById.mockImplementation(async () => {
      liftedInsideTransaction = transaction.mock.calls.length === 1;
      return { error: null };
    });

    expect(await reactivateTechnician(null, form({ id }))).toEqual({
      ok: true,
      message: "Tom Hendrickx is opnieuw actief. Je kan hem weer taken toewijzen.",
    });
    expect(reactivateTechnicianProfile).toHaveBeenCalledWith(tx, id);
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "none" });
    expect(liftedInsideTransaction).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("takes the id from the form only and ignores any other field", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    await reactivateTechnician(null, form({ id, email: "evil@example.com", fullName: "Evil" }));
    expect(reactivateTechnicianProfile).toHaveBeenCalledWith(tx, id);
    expect(updateUserById).toHaveBeenCalledWith(id, { ban_duration: "none" });
  });

  it.each([
    [{ kind: "not-found" }, "Deze technieker bestaat niet (meer). Laad de pagina opnieuw."],
    [
      { kind: "invited", fullName: "Yana Willems" },
      "Yana Willems heeft de uitnodiging nog niet aanvaard en is niet uitgeschakeld.",
    ],
  ])("refuses %j, changes nothing and lists no users", async (outcome, formError) => {
    reactivateTechnicianProfile.mockResolvedValue(outcome);
    expect(await reactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError,
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rolls back and reports a technical problem when lifting the block fails", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await reactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: technical,
    });
    // No second call: nothing was lifted, so there is nothing to block again.
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "none" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("blocks the account again when the commit fails after the block was lifted", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback(tx);
      throw new Error("commit failed");
    });
    expect(await reactivateTechnician(null, form({ id }))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(updateUserById).toHaveBeenNthCalledWith(1, id, { ban_duration: "none" });
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "87600h" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("still reports the problem when blocking again fails as well", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback(tx);
      throw new Error("commit failed");
    });
    updateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new AuthApiError("boom", 500, "unexpected_failure") });
    expect(await reactivateTechnician(null, form({ id }))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(updateUserById).toHaveBeenCalledTimes(2);
  });

  it("gives the technical message when the database fails, without personal data in the log", async () => {
    transaction.mockRejectedValue(new Error("db down for tom@frisair.be"));
    expect(await reactivateTechnician(null, form({ id }))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("tom@frisair.be");
  });

  it("logs the technician id when the account cannot be blocked again", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback(tx);
      throw new Error("commit failed");
    });
    updateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new AuthApiError("boom", 500, "unexpected_failure") });
    await reactivateTechnician(null, form({ id }));
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain(id);
    expect(logged).not.toContain("Tom");
  });

  it("lifts the block when the technician turns out to be active already (ambiguous commit)", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "already-active",
      fullName: "Tom Hendrickx",
    });
    expect(await reactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Tom Hendrickx is al actief. Laad de pagina opnieuw.",
    });
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "none" });
  });

  it("repairs the block inside the transaction, while the row lock is still held", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "already-active",
      fullName: "Tom Hendrickx",
    });
    let transactionOpen = false;
    let repairedInside = false;
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(tx);
      } finally {
        transactionOpen = false;
      }
    });
    updateUserById.mockImplementation(async () => {
      repairedInside = transactionOpen;
      return { error: null };
    });
    await reactivateTechnician(null, form({ id }));
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "none" });
    expect(repairedInside).toBe(true);
  });

  it("only logs when repairing the block fails: no rollback, no extra attempts", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "already-active",
      fullName: "Tom Hendrickx",
    });
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    await reactivateTechnician(null, form({ id }));
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).toContain(id);
  });

  it("gives the same message and logs the id when repairing the block fails", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "already-active",
      fullName: "Tom Hendrickx",
    });
    updateUserById.mockResolvedValue({
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await reactivateTechnician(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Tom Hendrickx is al actief. Laad de pagina opnieuw.",
    });
    expect(JSON.stringify(consoleError.mock.calls)).toContain(id);
  });

  it("rolls back and blocks again when Auth does not answer in time", async () => {
    reactivateTechnicianProfile.mockResolvedValue({
      kind: "reactivated",
      fullName: "Tom Hendrickx",
    });
    vi.useFakeTimers();
    try {
      updateUserById.mockReturnValueOnce(new Promise(() => {}));
      updateUserById.mockResolvedValueOnce({ error: null });
      const result = reactivateTechnician(null, form({ id }));
      await vi.advanceTimersByTimeAsync(AUTH_BAN_TIMEOUT_MS);
      expect(await result).toMatchObject({ ok: false, formError: technical });
    } finally {
      vi.useRealTimers();
    }
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "87600h" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revokeInvitation", () => {
  const id = authUserId;
  const technical = "Dat is niet gelukt. Controleer je internetverbinding en probeer opnieuw.";
  const revoked = { kind: "revoked", fullName: "Yana Willems" };

  it("requires the backoffice role and touches nothing for anyone else", async () => {
    requireRole.mockRejectedValue(new AuthError("forbidden"));
    expect(await revokeInvitation(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Je hebt geen toegang om dit te doen.",
    });
    expect(requireRole).toHaveBeenCalledWith("backoffice");
    expect(transaction).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it.each(["unauthenticated", "inactive", "reset-pending"] as const)(
    "refuses a caller who is %s",
    async (code) => {
      requireRole.mockRejectedValue(new AuthError(code));
      expect(await revokeInvitation(null, form({ id }))).toMatchObject({ ok: false });
      expect(transaction).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    },
  );

  it("does not hide unexpected errors of the role check", async () => {
    requireRole.mockRejectedValue(new Error("boom"));
    await expect(revokeInvitation(null, form({ id }))).rejects.toThrow("boom");
  });

  it.each(["", "not-a-uuid", "x"])("refuses the id %j without a database call", async (bad) => {
    expect(await revokeInvitation(null, form({ id: bad }))).toMatchObject({
      ok: false,
      formError: "Deze technieker bestaat niet (meer). Laad de pagina opnieuw.",
    });
    expect(await revokeInvitation(null, new FormData())).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("removes the profile, blocks Auth inside the transaction, deletes the account after the commit", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    const order: string[] = [];
    updateUserById.mockImplementation(async () => {
      order.push(`block (inside transaction: ${transaction.mock.calls.length === 1})`);
      return { error: null };
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const result = await callback(tx);
      order.push("commit");
      return result;
    });
    deleteUser.mockImplementation(async () => {
      order.push("delete");
      return { error: null };
    });

    expect(await revokeInvitation(null, form({ id }))).toEqual({
      ok: true,
      message:
        "De uitnodiging van Yana Willems is ingetrokken. De link in de mail werkt niet meer.",
    });
    expect(revokeInvitationProfile).toHaveBeenCalledWith(tx, id);
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "87600h" });
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(id);
    expect(order).toEqual(["block (inside transaction: true)", "commit", "delete"]);
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("takes the id from the form only and ignores any other field", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    await revokeInvitation(null, form({ id, email: "evil@example.com", fullName: "Evil" }));
    expect(revokeInvitationProfile).toHaveBeenCalledWith(tx, id);
    expect(deleteUser).toHaveBeenCalledWith(id);
  });

  it.each([
    [{ kind: "not-found" }, "Deze technieker bestaat niet (meer). Laad de pagina opnieuw."],
    [
      { kind: "not-pending", fullName: "Yana Willems" },
      "Yana Willems heeft al een wachtwoord gekozen en kan niet meer ingetrokken worden. Laad de pagina opnieuw.",
    ],
    [
      { kind: "has-records", fullName: "Yana Willems" },
      "De uitnodiging van Yana Willems kan niet ingetrokken worden: er hangen nog gegevens aan.",
    ],
  ])("refuses %j and leaves Auth alone", async (outcome, formError) => {
    revokeInvitationProfile.mockResolvedValue(outcome);
    expect(await revokeInvitation(null, form({ id }))).toEqual({
      ok: false,
      fieldErrors: {},
      formError,
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rolls back, deletes nothing and reports a technical problem when the block fails", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    updateUserById.mockResolvedValue({
      error: new AuthApiError("nope", 500, "unexpected_failure"),
    });
    expect(await revokeInvitation(null, form({ id }))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  const failingCommit = () =>
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback(tx);
      throw new Error("commit failed");
    });

  it("lifts the block again, and deletes nothing, when the commit failed and the profile is still there", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    failingCommit();
    findFirst.mockResolvedValue({ id });
    expect(await revokeInvitation(null, form({ id }))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(updateUserById).toHaveBeenNthCalledWith(1, id, { ban_duration: "87600h" });
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "none" });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("keeps the block and deletes the account when the commit did succeed (profile gone)", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    failingCommit();
    findFirst.mockResolvedValue(undefined);
    expect(await revokeInvitation(null, form({ id }))).toMatchObject({ ok: true });
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "87600h" });
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(id);
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("leaves the block alone when the profile cannot be read again", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    failingCommit();
    findFirst.mockRejectedValue(new Error("connection lost"));
    expect(await revokeInvitation(null, form({ id }))).toMatchObject({
      ok: false,
      formError: technical,
    });
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith(id, { ban_duration: "87600h" });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("gives the technical message when the database fails, without personal data in the log", async () => {
    revokeInvitationProfile.mockRejectedValue(new Error("connection to yana@frisair.be lost"));
    expect(await revokeInvitation(null, form({ id }))).toMatchObject({ formError: technical });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("yana@frisair.be");
    expect(JSON.stringify(consoleError.mock.calls)).toContain(id);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("still reports success, and logs only the id, when deleting the blocked account fails", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    deleteUser.mockResolvedValue({
      error: new AuthApiError("Database error for yana@frisair.be", 500, "unexpected_failure"),
    });
    expect(await revokeInvitation(null, form({ id }))).toMatchObject({ ok: true });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).toContain(id);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("yana");
    expect(revalidatePath).toHaveBeenCalledWith("/technicians");
  });

  it("still reports success when Auth does not answer in time while deleting", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    deleteUser.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const result = revokeInvitation(null, form({ id }));
      await vi.advanceTimersByTimeAsync(AUTH_BAN_TIMEOUT_MS);
      expect(await result).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("rolls back and lifts a possibly applied block when Auth does not answer in time", async () => {
    revokeInvitationProfile.mockResolvedValue(revoked);
    findFirst.mockResolvedValue({ id });
    vi.useFakeTimers();
    try {
      updateUserById.mockReturnValueOnce(new Promise(() => {}));
      updateUserById.mockResolvedValueOnce({ error: null });
      const result = revokeInvitation(null, form({ id }));
      await vi.advanceTimersByTimeAsync(AUTH_BAN_TIMEOUT_MS);
      expect(await result).toMatchObject({ ok: false, formError: technical });
    } finally {
      vi.useRealTimers();
    }
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "none" });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
