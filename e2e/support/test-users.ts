/**
 * Users the end-to-end tests sign in with. They only exist in the local Supabase that runs
 * next to the tests (CI runner or the developer's machine) and are created by
 * `e2e/global-setup.ts`; the password is a test value, not a secret. Set E2E_TEST_PASSWORD
 * to use another one.
 */
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || "Test-wachtwoord-e2e-2026";

export type TestUser = {
  email: string;
  fullName: string;
  role: "backoffice" | "technician";
  /** Profile state (`profiles.is_active`). Defaults to active. */
  isActive?: boolean;
  /** Blocked in Supabase Auth, as switching off a technician does (BT-07). */
  banned?: boolean;
};

export const BACKOFFICE: TestUser = {
  email: "e2e-backoffice@example.com",
  fullName: "Sofie Peeters",
  role: "backoffice",
};

export const TECHNICIAN: TestUser = {
  email: "e2e-technician@example.com",
  fullName: "Kevin Wouters",
  role: "technician",
};

/** Deactivated in the application (`profiles.is_active = false`). */
export const INACTIVE_TECHNICIAN: TestUser = {
  email: "e2e-inactive@example.com",
  fullName: "Bram Claes",
  role: "technician",
  isActive: false,
};

/** Blocked in Supabase Auth, profile still active. */
export const BANNED_TECHNICIAN: TestUser = {
  email: "e2e-banned@example.com",
  fullName: "Tom Hendrickx",
  role: "technician",
  banned: true,
};

export const STATIC_USERS: TestUser[] = [
  BACKOFFICE,
  TECHNICIAN,
  INACTIVE_TECHNICIAN,
  BANNED_TECHNICIAN,
];
