import { describe, expect, it, vi } from "vitest";

import { parseArgs, seedBackoffice, UsageError, type SeedDeps } from "./seed-backoffice.mjs";

const input = { fullName: "Sofie Peeters", email: "sofie@example.be" };

function fakeDeps(overrides: Partial<SeedDeps> = {}): SeedDeps {
  return {
    findAuthUserId: vi.fn().mockResolvedValue(null),
    createAuthUser: vi.fn().mockResolvedValue("user-id"),
    ensureProfile: vi.fn().mockResolvedValue({ created: true, role: "backoffice" }),
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("reads name and e-mail, and lowercases the e-mail", () => {
    expect(parseArgs(["Sofie Peeters", "Sofie@Example.be"])).toEqual(input);
  });

  it.each([[[]], [["Sofie"]], [["", "sofie@example.be"]], [["Sofie", "not-an-email"]]])(
    "rejects %j with a usage message",
    (args) => {
      expect(() => parseArgs(args)).toThrow(UsageError);
      expect(() => parseArgs(args)).toThrow(/Usage: pnpm seed:backoffice/);
    },
  );

  it("rejects extra arguments", () => {
    expect(() => parseArgs(["Sofie", "sofie@example.be", "extra"])).toThrow(UsageError);
  });
});

describe("seedBackoffice", () => {
  it("creates the Auth user and the profile, with a generated password", async () => {
    const deps = fakeDeps();
    const result = await seedBackoffice(deps, input);

    expect(result).toMatchObject({ authUser: "created", profile: "created" });
    expect(result.generatedPassword).toHaveLength(24);
    expect(deps.createAuthUser).toHaveBeenCalledWith({
      ...input,
      password: result.generatedPassword,
    });
    expect(deps.ensureProfile).toHaveBeenCalledWith({ ...input, id: "user-id" });
  });

  it("uses the given password and does not echo it back", async () => {
    const deps = fakeDeps();
    const result = await seedBackoffice(deps, input, { password: "a-long-enough-password" });

    expect(result.generatedPassword).toBeUndefined();
    expect(deps.createAuthUser).toHaveBeenCalledWith({
      ...input,
      password: "a-long-enough-password",
    });
  });

  it("rejects a password that is too short before creating anything", async () => {
    const deps = fakeDeps();
    await expect(seedBackoffice(deps, input, { password: "short" })).rejects.toThrow(
      /at least 12 characters/,
    );
    expect(deps.createAuthUser).not.toHaveBeenCalled();
  });

  it("is idempotent: an existing user and profile are left alone", async () => {
    const deps = fakeDeps({
      findAuthUserId: vi.fn().mockResolvedValue("existing-id"),
      ensureProfile: vi.fn().mockResolvedValue({ created: false, role: "backoffice" }),
    });
    const result = await seedBackoffice(deps, input);

    expect(result).toEqual({ authUser: "existing", profile: "existing" });
    expect(deps.createAuthUser).not.toHaveBeenCalled();
    expect(deps.ensureProfile).toHaveBeenCalledWith({ ...input, id: "existing-id" });
  });

  it("completes a half-finished earlier run (Auth user without profile)", async () => {
    const deps = fakeDeps({ findAuthUserId: vi.fn().mockResolvedValue("existing-id") });
    const result = await seedBackoffice(deps, input);

    expect(result).toEqual({ authUser: "existing", profile: "created" });
    expect(deps.createAuthUser).not.toHaveBeenCalled();
  });

  it("refuses to touch an existing user with another role", async () => {
    const deps = fakeDeps({
      findAuthUserId: vi.fn().mockResolvedValue("existing-id"),
      ensureProfile: vi.fn().mockResolvedValue({ created: false, role: "technician" }),
    });
    await expect(seedBackoffice(deps, input)).rejects.toThrow(/role "technician"/);
  });
});
