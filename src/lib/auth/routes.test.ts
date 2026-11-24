import { describe, expect, it } from "vitest";

import { accessRedirect, homePathForRole, isPublicPath } from "./routes";

describe("homePathForRole", () => {
  it("sends technicians to their tasks and backoffice to the task overview", () => {
    expect(homePathForRole("technician")).toBe("/my-tasks");
    expect(homePathForRole("backoffice")).toBe("/tasks");
  });
});

describe("isPublicPath", () => {
  it.each(["/login", "/forgot-password", "/auth/confirm", "/auth/confirm/extra"])(
    "%s is public",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each([
    "/",
    "/tasks",
    "/my-tasks",
    "/set-password",
    "/auth/inactive",
    "/login-evil",
    "/logins",
  ])("%s is not public", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("accessRedirect", () => {
  const visit = (pathname: string, signedIn: boolean, method = "GET") =>
    accessRedirect({ pathname, method, signedIn });

  it("sends visitors without a session from a protected page to the login page", () => {
    expect(visit("/", false)).toBe("/login");
    expect(visit("/tasks", false)).toBe("/login");
    expect(visit("/my-tasks/42", false)).toBe("/login");
    expect(visit("/auth/inactive", false)).toBe("/login");
  });

  it("lets visitors without a session open the public pages", () => {
    expect(visit("/login", false)).toBeNull();
    expect(visit("/login", false, "POST")).toBeNull();
    expect(visit("/auth/confirm", false)).toBeNull();
  });

  it("sends a signed-in user away from the login page", () => {
    expect(visit("/login", true)).toBe("/");
    expect(visit("/login", true, "HEAD")).toBe("/");
  });

  it("lets a form post reach the login action even when signed in", () => {
    expect(visit("/login", true, "POST")).toBeNull();
  });

  it("lets a signed-in user open every other page", () => {
    expect(visit("/", true)).toBeNull();
    expect(visit("/tasks", true)).toBeNull();
    expect(visit("/my-tasks", true)).toBeNull();
  });
});
