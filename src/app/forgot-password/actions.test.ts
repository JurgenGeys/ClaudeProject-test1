import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resetPasswordForEmail, findProfile, after, afterTasks } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  findProfile: vi.fn(),
  after: vi.fn(),
  afterTasks: [] as (() => Promise<void>)[],
}));
vi.mock("@/lib/supabase/credentials", () => ({
  createSupabaseCredentialsClient: () => ({ auth: { resetPasswordForEmail } }),
}));
vi.mock("@/db/client", () => ({
  getDb: () => ({ query: { profiles: { findFirst: findProfile } } }),
}));
// `after` runs the work after the response; the tests collect it and run it when they want.
vi.mock("next/server", () => ({ after }));

import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const SENT: ForgotPasswordState = { sent: true };
const EMAIL = "sofie@frisair.be";

function form(email: string | undefined): FormData {
  const data = new FormData();
  if (email !== undefined) {
    data.set("email", email);
  }
  return data;
}

/** Posts the form and then lets the work after the response finish. */
async function request(email: string | undefined) {
  const answer = await requestPasswordReset(null, form(email));
  for (const task of afterTasks.splice(0)) {
    await task();
  }
  return answer;
}

const activeProfile = { id: "u1", email: EMAIL, isActive: true, role: "backoffice" };

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  afterTasks.length = 0;
  after.mockImplementation((task: () => Promise<void>) => {
    afterTasks.push(task);
  });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  findProfile.mockResolvedValue(activeProfile);
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

describe("requestPasswordReset: the same answer for everybody", () => {
  it("sends the mail to an active user and says it was sent", async () => {
    expect(await request(EMAIL)).toEqual(SENT);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, {
      // From SITE_URL, never from the request.
      redirectTo: "http://localhost:3000/auth/confirm",
    });
  });

  it.each([
    ["an active user", activeProfile],
    ["an address without a profile", undefined],
    ["a deactivated user", { ...activeProfile, isActive: false }],
  ])("gives exactly the same answer for %s", async (_name, profile) => {
    findProfile.mockResolvedValue(profile);
    expect(await request(EMAIL)).toStrictEqual(SENT);
  });

  it.each([
    ["an address without a profile", undefined],
    ["a deactivated user", { ...activeProfile, isActive: false }],
  ])("asks Supabase for no mail for %s", async (_name, profile) => {
    findProfile.mockResolvedValue(profile);
    await request(EMAIL);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does the work after the response, so the answer is no faster for an unknown address", async () => {
    const answer = await requestPasswordReset(null, form(EMAIL));
    expect(answer).toEqual(SENT);
    expect(after).toHaveBeenCalledTimes(1);
    // Nothing has happened yet when the answer is given.
    expect(findProfile).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("looks the address up case-insensitively and trims it", async () => {
    expect(await request("  Sofie@FrisAir.be ")).toEqual(SENT);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, expect.anything());
  });

  it("uses the address as stored in the profile for the mail", async () => {
    findProfile.mockResolvedValue({ ...activeProfile, email: "Sofie@frisair.be" });
    await request("sofie@frisair.be");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("Sofie@frisair.be", expect.anything());
  });
});

describe("requestPasswordReset: errors of Supabase never reach the screen", () => {
  it.each([
    [
      "the interval of one mail per minute",
      new AuthApiError("wait", 429, "over_email_send_rate_limit"),
    ],
    ["the request limit", new AuthApiError("slow down", 429, "over_request_rate_limit")],
  ])("gives the same answer when Supabase refuses because of %s", async (_name, error) => {
    resetPasswordForEmail.mockResolvedValue({ data: null, error });
    expect(await request(EMAIL)).toStrictEqual(SENT);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["a server error", new AuthApiError("Error sending recovery email", 500, "unexpected_failure")],
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
  ])("gives the same answer after %s, and logs it without the address", async (_name, error) => {
    resetPasswordForEmail.mockResolvedValue({ data: null, error });
    expect(await request(EMAIL)).toStrictEqual(SENT);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(EMAIL);
  });

  it("gives the same answer when the database fails, and logs no address", async () => {
    findProfile.mockRejectedValue(new Error(`db down while looking for ${EMAIL}`));
    expect(await request(EMAIL)).toStrictEqual(SENT);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(EMAIL);
  });

  it("gives the same answer, and logs the cause, when SITE_URL is not set", async () => {
    vi.stubEnv("SITE_URL", "");
    expect(await request(EMAIL)).toStrictEqual(SENT);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("requestPasswordReset: validation", () => {
  it.each([
    ["nothing", undefined, "Vul je e-mailadres in."],
    ["an empty address", "", "Vul je e-mailadres in."],
    ["only spaces", "   ", "Vul je e-mailadres in."],
    ["no address", "geen-adres", "Vul een geldig e-mailadres in."],
    ["half an address", "sofie@", "Vul een geldig e-mailadres in."],
  ])("refuses %s with a field error, and does nothing else", async (_name, email, message) => {
    expect(await request(email)).toEqual({
      sent: false,
      email: email ?? "",
      fieldErrors: { email: message },
    });
    expect(after).not.toHaveBeenCalled();
    expect(findProfile).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
