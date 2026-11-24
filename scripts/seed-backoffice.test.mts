import { describe, expect, it, vi } from "vitest";

import {
  parseArgs,
  readEnv,
  ScriptError,
  seedBackoffice,
  type SeedDeps,
} from "./seed-backoffice.mjs";

const input = { fullName: "Sofie Peeters", email: "sofie@example.be" };

function fakeDeps(overrides: Partial<SeedDeps> = {}): SeedDeps {
  return {
    checkDatabase: vi.fn().mockResolvedValue(undefined),
    findAuthUserId: vi.fn().mockResolvedValue(null),
    createAuthUser: vi.fn().mockResolvedValue("user-id"),
    ensureProfile: vi.fn().mockResolvedValue({ created: true, role: "backoffice", isActive: true }),
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("reads name and e-mail, and lowercases the e-mail", () => {
    expect(parseArgs(["Sofie Peeters", "Sofie@Example.be"])).toEqual(input);
  });

  it.each([[[]], [["Sofie"]], [["", "sofie@example.be"]], [["Sofie", "not-an-email"]]])(
    "rejects %j with a short usage message",
    (args) => {
      expect(() => parseArgs(args)).toThrow(ScriptError);
      expect(() => parseArgs(args)).toThrow(/Usage: pnpm seed:backoffice/);
    },
  );

  it("rejects extra arguments", () => {
    expect(() => parseArgs(["Sofie", "sofie@example.be", "extra"])).toThrow(ScriptError);
  });
});

describe("readEnv", () => {
  const complete = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  };

  it("returns the settings", () => {
    expect(readEnv(complete)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      secretKey: "sb_secret_test",
      databaseUrl: complete.DATABASE_URL,
      password: undefined,
    });
  });

  it("names every missing variable in one readable message", () => {
    expect(() => readEnv({ DATABASE_URL: complete.DATABASE_URL })).toThrow(
      /Missing environment variable\(s\): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY\./,
    );
  });

  it("rejects an invalid URL", () => {
    expect(() => readEnv({ ...complete, NEXT_PUBLIC_SUPABASE_URL: "nope" })).toThrow(
      /not a valid URL/,
    );
  });
});

describe("seedBackoffice", () => {
  it("creates the Auth user and the profile, and hands over the generated password", async () => {
    const deps = fakeDeps();
    const onGeneratedPassword = vi.fn();
    const result = await seedBackoffice(deps, input, { onGeneratedPassword });

    expect(result).toEqual({ authUser: "created", profile: "created", warnings: [] });
    expect(onGeneratedPassword).toHaveBeenCalledTimes(1);
    const password = onGeneratedPassword.mock.calls[0][0] as string;
    expect(password).toHaveLength(24);
    expect(deps.createAuthUser).toHaveBeenCalledWith({ ...input, password });
    expect(deps.ensureProfile).toHaveBeenCalledWith({ ...input, id: "user-id" });
  });

  it("uses the given password and reports no generated one", async () => {
    const deps = fakeDeps();
    const onGeneratedPassword = vi.fn();
    await seedBackoffice(deps, input, { password: "a-long-enough-password", onGeneratedPassword });

    expect(onGeneratedPassword).not.toHaveBeenCalled();
    expect(deps.createAuthUser).toHaveBeenCalledWith({
      ...input,
      password: "a-long-enough-password",
    });
  });

  it("rejects a password that is too short before touching anything", async () => {
    const deps = fakeDeps();
    await expect(seedBackoffice(deps, input, { password: "short" })).rejects.toThrow(
      /at least 12 characters/,
    );
    expect(deps.checkDatabase).not.toHaveBeenCalled();
    expect(deps.createAuthUser).not.toHaveBeenCalled();
  });

  it("creates no Auth user when the database check fails", async () => {
    const deps = fakeDeps({
      checkDatabase: vi.fn().mockRejectedValue(new ScriptError("Run `pnpm db:migrate` first.")),
    });
    const onGeneratedPassword = vi.fn();

    await expect(seedBackoffice(deps, input, { onGeneratedPassword })).rejects.toThrow(
      /db:migrate/,
    );
    expect(deps.findAuthUserId).not.toHaveBeenCalled();
    expect(deps.createAuthUser).not.toHaveBeenCalled();
    expect(onGeneratedPassword).not.toHaveBeenCalled();
  });

  it("still hands over the generated password when creating the profile fails", async () => {
    const deps = fakeDeps({ ensureProfile: vi.fn().mockRejectedValue(new Error("insert failed")) });
    const onGeneratedPassword = vi.fn();

    await expect(seedBackoffice(deps, input, { onGeneratedPassword })).rejects.toThrow(
      "insert failed",
    );
    expect(deps.createAuthUser).toHaveBeenCalledTimes(1);
    expect(onGeneratedPassword).toHaveBeenCalledTimes(1);
    expect(onGeneratedPassword).toHaveBeenCalledWith(
      (deps.createAuthUser as ReturnType<typeof vi.fn>).mock.calls[0][0].password,
    );
  });

  it("is idempotent: an existing user and profile are left alone", async () => {
    const deps = fakeDeps({
      findAuthUserId: vi.fn().mockResolvedValue("existing-id"),
      ensureProfile: vi
        .fn()
        .mockResolvedValue({ created: false, role: "backoffice", isActive: true }),
    });
    const result = await seedBackoffice(deps, input);

    expect(result).toEqual({ authUser: "existing", profile: "existing", warnings: [] });
    expect(deps.createAuthUser).not.toHaveBeenCalled();
  });

  it("warns when an existing Auth user without profile becomes backoffice", async () => {
    const deps = fakeDeps({ findAuthUserId: vi.fn().mockResolvedValue("existing-id") });
    const result = await seedBackoffice(deps, input);

    expect(result).toMatchObject({ authUser: "existing", profile: "created" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/already had a login .* no profile/);
    expect(deps.createAuthUser).not.toHaveBeenCalled();
  });

  it("warns when the existing backoffice profile is deactivated", async () => {
    const deps = fakeDeps({
      findAuthUserId: vi.fn().mockResolvedValue("existing-id"),
      ensureProfile: vi
        .fn()
        .mockResolvedValue({ created: false, role: "backoffice", isActive: false }),
    });
    const result = await seedBackoffice(deps, input);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/deactivated/);
  });

  it("refuses to touch an existing user with another role", async () => {
    const deps = fakeDeps({
      findAuthUserId: vi.fn().mockResolvedValue("existing-id"),
      ensureProfile: vi
        .fn()
        .mockResolvedValue({ created: false, role: "technician", isActive: true }),
    });
    await expect(seedBackoffice(deps, input)).rejects.toThrow(/role "technician"/);
  });
});
