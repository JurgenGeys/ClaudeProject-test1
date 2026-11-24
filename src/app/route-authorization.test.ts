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
    expect(names).toContain("(technician)/my-tasks/page.tsx");
  });

  it.each(guarded.map((file) => [relative(APP_DIR, file).replaceAll("\\", "/"), file]))(
    "%s checks the role itself",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).toMatch(CHECKS);
    },
  );
});
