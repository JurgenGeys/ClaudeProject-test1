import { expect, test, type Page } from "@playwright/test";

import { openLoginPage, signIn } from "./support/sign-in";
import {
  BACKOFFICE,
  BANNED_TECHNICIAN,
  INACTIVE_TECHNICIAN,
  TECHNICIAN,
  TEST_PASSWORD,
  type TestUser,
} from "./support/test-users";
import { ensureUser, setProfileActive } from "./support/users";

// Next.js has its own role="alert" (route announcer), so look inside the form.
const formMessage = (page: Page) => page.locator("form").getByRole("alert");

const MISMATCH = "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.";
const DISABLED = "Je account is uitgeschakeld. Neem contact op met kantoor.";
const NOT_FOR_YOU = "Deze pagina is niet voor jou bedoeld";

// Every sign-in counts towards the rate limit of the local Auth server (30 per 5 minutes per
// IP), and both projects (desktop and mobile) run this file. Tests therefore sign in once and
// check several things in that session.

test.describe("sign in", () => {
  test("backoffice lands on the task overview, is kept out of technician pages and can sign out", async ({
    page,
  }) => {
    await signIn(page, BACKOFFICE);
    await expect(page).toHaveURL("/tasks");
    await expect(page.getByRole("heading", { level: 1, name: "Taken" })).toBeVisible();
    await expect(page.getByText(BACKOFFICE.fullName)).toBeVisible();

    await test.step("a technician page says it is not meant for this user", async () => {
      await page.goto("/my-tasks");
      await expect(page.getByRole("heading", { level: 1, name: NOT_FOR_YOU })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Mijn taken" })).toHaveCount(0);
      await page.getByRole("link", { name: "Naar de taken" }).click();
      await expect(page).toHaveURL("/tasks");
    });

    await test.step("the start page and the login page lead back to the own start page", async () => {
      await page.goto("/");
      await expect(page).toHaveURL("/tasks");
      await page.goto("/login");
      await expect(page).toHaveURL("/tasks");
    });

    await test.step("signing out ends the session", async () => {
      await page.getByRole("button", { name: "Uitloggen" }).click();
      await expect(page).toHaveURL("/login");
      await page.goto("/tasks");
      await expect(page).toHaveURL("/login");
    });
  });

  test("technician lands on Mijn taken and is kept out of backoffice pages", async ({ page }) => {
    await signIn(page, TECHNICIAN);
    await expect(page).toHaveURL("/my-tasks");
    await expect(page.getByRole("heading", { level: 1, name: "Mijn taken" })).toBeVisible();
    await expect(page.getByText(TECHNICIAN.fullName)).toBeVisible();

    await test.step("a backoffice page says it is not meant for this user", async () => {
      await page.goto("/tasks");
      await expect(page.getByRole("heading", { level: 1, name: NOT_FOR_YOU })).toBeVisible();
      await page.getByRole("link", { name: "Naar mijn taken" }).click();
      await expect(page).toHaveURL("/my-tasks");
    });

    await test.step("the start page leads to Mijn taken", async () => {
      await page.goto("/");
      await expect(page).toHaveURL("/my-tasks");
    });
  });

  test("wrong credentials give one message, whether the address exists or not", async ({
    page,
  }) => {
    await signIn(page, TECHNICIAN, "een-verkeerd-wachtwoord");
    await expect(formMessage(page)).toHaveText(MISMATCH);
    await expect(page).toHaveURL("/login");
    // The address stays in the form; the password does not.
    await expect(page.getByLabel("E-mailadres")).toHaveValue(TECHNICIAN.email);
    await expect(page.getByLabel("Wachtwoord", { exact: true })).toHaveValue("");

    await signIn(page, { email: "bestaat-niet@example.com" });
    await expect(formMessage(page)).toHaveText(MISMATCH);
    await expect(page).toHaveURL("/login");
  });

  test("empty fields are reported next to the fields", async ({ page }) => {
    await openLoginPage(page);
    await page.getByRole("button", { name: "Aanmelden" }).click();

    await expect(formMessage(page)).toHaveText("Vul de 2 gemarkeerde velden in.");
    await expect(page.getByLabel("E-mailadres")).toHaveAccessibleDescription(
      "Vul je e-mailadres in.",
    );
    await expect(page.getByLabel("Wachtwoord", { exact: true })).toHaveAccessibleDescription(
      "Vul je wachtwoord in.",
    );
    await expect(page).toHaveURL("/login");
  });

  test("the form works with the keyboard alone", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard navigation is a desktop concern");
    await openLoginPage(page);
    await page.getByLabel("E-mailadres").focus();
    await page.keyboard.type(TECHNICIAN.email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(TEST_PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/my-tasks");
  });
});

test.describe("disabled accounts", () => {
  test("a deactivated profile is refused with the right message", async ({ page }) => {
    await signIn(page, INACTIVE_TECHNICIAN);
    await expect(formMessage(page)).toHaveText(DISABLED);
    await expect(page).toHaveURL("/login");
    // No session was left behind.
    await page.goto("/my-tasks");
    await expect(page).toHaveURL("/login");
  });

  test("a user blocked in Supabase Auth is refused with the same message", async ({ page }) => {
    await signIn(page, BANNED_TECHNICIAN);
    await expect(formMessage(page)).toHaveText(DISABLED);
    await expect(page).toHaveURL("/login");
  });

  test("a signed-in user who gets deactivated is signed out at the next request", async ({
    page,
  }, testInfo) => {
    // Own user per project: the two projects run in parallel and one flips the profile.
    const user: TestUser = {
      email: `e2e-midsession-${testInfo.project.name}@example.com`,
      fullName: "Wim Janssens",
      role: "technician",
    };
    await ensureUser(user);

    await signIn(page, user);
    await expect(page).toHaveURL("/my-tasks");

    await setProfileActive(user.email, false);
    await page.goto("/my-tasks");

    await expect(page).toHaveURL("/login?reason=disabled");
    await expect(formMessage(page)).toHaveText(DISABLED);
    // The session is really gone, not just hidden.
    await page.goto("/my-tasks");
    await expect(page).toHaveURL("/login");
  });
});
