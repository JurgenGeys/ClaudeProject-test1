import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A layout does not protect the page below it (Next.js docs: it does not re-render on
 * navigation and does not stop the page from rendering), so every page and route handler in
 * a role-bound route group must check the role itself (ADR-0002, rule 3).
 */
const GROUPS = ["(backoffice)", "(technician)"];
const APP_DIR = join(process.cwd(), "src", "app");
const CHECKS = /\b(checkRoleAccess|requireRole)\s*\(/;

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

const guarded = GROUPS.flatMap((group) => filesIn(join(APP_DIR, group))).filter((file) =>
  /(^|[\\/])(page|route)\.tsx?$/.test(file),
);

describe("authorization per page and route handler", () => {
  it("finds the pages of both route groups", () => {
    const names = guarded.map((file) => relative(APP_DIR, file).replaceAll("\\", "/"));
    expect(names).toContain("(backoffice)/tasks/page.tsx");
    expect(names).toContain("(backoffice)/technicians/page.tsx");
    expect(names).toContain("(technician)/my-tasks/page.tsx");
  });

  it.each(guarded.map((file) => [relative(APP_DIR, file).replaceAll("\\", "/"), file]))(
    "%s checks the role itself",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).toMatch(CHECKS);
    },
  );
});

/**
 * The same for Server Actions: they are public endpoints that anybody can post to, so every
 * exported function of an `actions.ts` must start with an authorization check of its own.
 * - In the two role-bound route groups that is `requireRole`.
 * - Outside them, every `actions.ts` is listed here with the check it uses and why, so a new
 *   file cannot be added without somebody deciding what protects it.
 */
const SRC_DIR = join(process.cwd(), "src");

const OTHER_ACTIONS: Record<string, { check: RegExp; why: string }> = {
  "app/login/actions.ts": {
    check: /signInWithPassword\(/,
    why: "public by design: it is the sign-in; the password and the profile are checked in it",
  },
  "app/auth/actions.ts": {
    check: /signOut\(/,
    why: "everybody, also a deactivated or pending user, must be able to sign out",
  },
  "app/auth/confirm/actions.ts": {
    check: /verifyOtp\(/,
    why: "the one-time token of the invitation link is the credential",
  },
  "app/set-password/actions.ts": {
    check: /getAuthState\(/,
    why: "only a session in the state `password-pending` may choose a password",
  },
};

const actionFiles = filesIn(APP_DIR)
  .filter((file) => /(^|[\\/])actions\.ts$/.test(file))
  .map((file) => ({ file, name: relative(SRC_DIR, file).replaceAll("\\", "/") }));

/** The exported functions of a "use server" file with their bodies (up to the next export). */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const parts = source.split(/^export async function /m).slice(1);
  return parts.map((part) => ({ name: /^(\w+)/.exec(part)![1], body: part }));
}

describe("authorization per Server Action", () => {
  it("finds the action files of the app", () => {
    const names = actionFiles.map((entry) => entry.name);
    expect(names).toContain("app/(backoffice)/technicians/actions.ts");
    expect(names).toContain("app/set-password/actions.ts");
    expect(names).toContain("app/auth/confirm/actions.ts");
  });

  it.each(actionFiles.map(({ file, name }) => [name, file]))(
    "%s only exports async functions that check who is calling",
    (name, file) => {
      const source = readFileSync(file, "utf8");
      // A "use server" file turns every export into a public endpoint; anything but an async function would be a mistake.
      expect(source, "needs 'use server'").toMatch(/^"use server";/);
      expect(source).not.toMatch(/^export (const|let|var|default|function)\b/m);

      const functions = exportedFunctions(source);
      expect(functions.length).toBeGreaterThan(0);

      const inGroup = GROUPS.some((group) => name.startsWith(`app/${group}/`));
      const check = inGroup ? CHECKS : OTHER_ACTIONS[name]?.check;
      expect(
        check,
        `${name} is not in a role-bound route group: list it in OTHER_ACTIONS`,
      ).toBeDefined();
      for (const { name: functionName, body } of functions) {
        expect(body, `${functionName} must check who is calling`).toMatch(check!);
      }
    },
  );

  it("has a reason for every file in OTHER_ACTIONS that exists", () => {
    for (const [name, { why }] of Object.entries(OTHER_ACTIONS)) {
      expect(why.length).toBeGreaterThan(10);
      expect(actionFiles.map((entry) => entry.name)).toContain(name);
    }
  });
});
