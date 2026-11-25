import { describe, expect, it } from "vitest";

import { accessRedirect, homePathForRole, isPublicPath } from "./routes";

describe("homePathForRole", () => {
  it("sends technicians to their tasks and backoffice to the task overview", () => {
    expect(homePathForRole("technician")).toBe("/my-tasks");
    expect(homePathForRole("backoffice")).toBe("/tasks");
  });
});

describe("isPublicPath", () => {
  it.each(["/login", "/auth/clear-session", "/auth/confirm", "/set-password"])(
    "%s is public",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each([
    "/",
    "/tasks",
    "/technicians",
    "/my-tasks",
    "/auth/inactive",
    "/forgot-password",
    "/login-evil",
    "/logins",
    "/set-password-evil",
    "/auth/confirmed",
  ])("%s is not public", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("accessRedirect", () => {
  const visit = (pathname: string, signedIn: boolean) => accessRedirect({ pathname, signedIn });

  it("sends visitors without a session from a protected page to the login page", () => {
    expect(visit("/", false)).toBe("/login");
    expect(visit("/tasks", false)).toBe("/login");
    expect(visit("/my-tasks/42", false)).toBe("/login");
    expect(visit("/auth/inactive", false)).toBe("/login");
  });

  it("lets visitors without a session open the public pages", () => {
    expect(visit("/login", false)).toBeNull();
    expect(visit("/auth/clear-session", false)).toBeNull();
    expect(visit("/auth/confirm", false)).toBeNull();
    expect(visit("/set-password", false)).toBeNull();
  });

  it("never redirects a signed-in user, also not on /login (the login page decides that)", () => {
    for (const path of ["/", "/login", "/tasks", "/my-tasks", "/auth/clear-session"]) {
      expect(visit(path, true)).toBeNull();
    }
  });
});
