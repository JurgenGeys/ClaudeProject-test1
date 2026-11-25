import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { countMails, waitForConfirmLinks } from "./support/mailbox";
import { signIn } from "./support/sign-in";
import { TEST_PASSWORD, type TestUser } from "./support/test-users";
import { ensureUser, removeUser, setProfileActive, setRecoveryVerifiedAt } from "./support/users";

const SENT =
  "Als dit e-mailadres bij ons gekend is, krijg je binnen enkele minuten een mail met een link om een nieuw wachtwoord te kiezen.";
const MISMATCH = "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.";
const LINK_INVALID = "Deze link is niet meer geldig.";
const LINK_EXPIRED = "De link is verlopen. Vraag een nieuwe link aan.";
const SET_PASSWORD_RESET = /\/set-password\?mode=reset$/;
const NEW_PASSWORD = "Een-heel-nieuw-wachtwoord-2026";

type Role = TestUser["role"];

/**
 * `makeUser` creates a user of this test only (own address, own password, both projects run in
 * parallel) and removes it afterwards. The fixed test users of the other tests are never reset,
 * so their password stays what the other tests expect.
 */
const test = base.extend<{
  makeUser: (role: Role, overrides?: Partial<TestUser>) => Promise<TestUser>;
}>({
  // Playwright requires an object pattern as first argument; this fixture uses no other fixtures.
  makeUser: async ({}, run, testInfo) => {
    const created: string[] = [];
    await run(async (role, overrides = {}) => {
      const random = Math.random().toString(36).slice(2, 8);
      const user: TestUser = {
        email: `e2e-reset-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
        fullName: role === "backoffice" ? "Rita Reset" : "Tom Reset",
        role,
        ...overrides,
      };
      created.push(user.email);
      await ensureUser(user);
      return user;
    });
    for (const email of created) {
      await removeUser(email);
    }
  },
});

const START_PAGE: Record<Role, string> = { backoffice: "/tasks", technician: "/my-tasks" };

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL("/login");
}

/** Signs in and waits for the start page: `signIn` itself does not wait for the result. */
async function signInAndWait(page: Page, user: TestUser, password = TEST_PASSWORD) {
  await signIn(page, user, password);
  await expect(page).toHaveURL(START_PAGE[user.role]);
}

/**
 * The visible page. After a client-side navigation Next.js keeps the previous route hidden in
 * the DOM (it has the same labels and `data-hydrated` forms), so locators for fields are always
 * scoped to what is visible.
 */
const visibleMain = (page: Page) => page.locator("main:visible");

/** From the login page through "Wachtwoord vergeten?" to the confirmation message. */
async function requestLink(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("link", { name: "Wachtwoord vergeten?" }).click();
  await expect(page).toHaveURL("/forgot-password");
  await expect(page.getByRole("heading", { level: 1, name: "Wachtwoord vergeten" })).toBeVisible();
  await page.locator('form[data-hydrated="true"]:visible').waitFor();
  await visibleMain(page).getByLabel("E-mailadres").fill(email);
  await visibleMain(page).getByRole("button", { name: "Stuur mij een link" }).click();
  await expect(page.getByRole("status")).toHaveText(SENT);
}

/**
 * Asks for one more mail for this address and returns its link. `before` is the number of mails
 * the address already got. Auth wants a short interval between two mails, so a request that was
 * swallowed is repeated.
 */
async function requestNextLink(page: Page, email: string, before: number): Promise<string> {
  await expect(async () => {
    await requestLink(page, email);
    expect(await countMails(email)).toBeGreaterThan(before);
  }).toPass({ timeout: 30_000 });
  const [newest] = await waitForConfirmLinks(email, before + 1);
  return newest;
}

/** Opens the link from the mail and presses the button on the page it leads to. */
async function openLinkAndConfirm(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await expect(page).toHaveURL(/\/auth\/confirm\?/);
  await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
  await expect(page).toHaveURL(SET_PASSWORD_RESET);
  await expect(
    page.getByRole("heading", { level: 1, name: "Nieuw wachtwoord kiezen" }),
  ).toBeVisible();
  await page.locator('form[data-hydrated="true"]:visible').waitFor();
}

async function choosePassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(password);
  await page.getByLabel("Herhaal wachtwoord").fill(password);
  await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
}

for (const role of ["backoffice", "technician"] as const) {
  test.describe(`forgot password as ${role}`, () => {
    test(`a ${role} asks for a link, sets a new password through the mail and can only use the new one`, async ({
      page,
      makeUser,
    }) => {
      const user = await makeUser(role);

      let link: string;
      await test.step("asks for a link on the page behind 'Wachtwoord vergeten?'", async () => {
        await requestLink(page, user.email);
        link = (await waitForConfirmLinks(user.email, 1))[0];
        expect(new URL(link).pathname).toBe("/auth/confirm");
        expect(new URL(link).searchParams.get("type")).toBe("recovery");
        expect(new URL(link).searchParams.get("token_hash")).toBeTruthy();
      });

      await test.step("a mail scanner that fetches the link does not use it up", async () => {
        expect((await page.request.get(link)).ok()).toBe(true);
        expect((await page.request.head(link)).ok()).toBe(true);
        await page.goto("/");
        await expect(page).toHaveURL("/login");
      });

      await test.step("the link leads to a page with a button, then to the new password form", async () => {
        await page.goto(link);
        await expect(
          page.getByRole("heading", { level: 1, name: "Nieuw wachtwoord kiezen" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
        await expect(page).toHaveURL(SET_PASSWORD_RESET);
        await expect(page.getByText(`Kies een nieuw wachtwoord voor ${user.email}.`)).toBeVisible();
        await page.locator('form[data-hydrated="true"]:visible').waitFor();
      });

      await test.step("the recovery session cannot open any other page", async () => {
        for (const path of [
          "/tasks",
          "/my-tasks",
          "/technicians",
          "/",
          "/login",
          "/forgot-password",
        ]) {
          await page.goto(path);
          await expect(page).toHaveURL(SET_PASSWORD_RESET);
        }
        await page.locator('form[data-hydrated="true"]:visible').waitFor();
      });

      await test.step("a short password and two different passwords are refused", async () => {
        await choosePassword(page, "kort");
        await expect(
          page.getByLabel("Nieuw wachtwoord", { exact: true }),
        ).toHaveAccessibleDescription(/Je wachtwoord moet minstens 8 tekens hebben\./);
        await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(NEW_PASSWORD);
        await page.getByLabel("Herhaal wachtwoord").fill(`${NEW_PASSWORD}-anders`);
        await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
        await expect(page.getByLabel("Herhaal wachtwoord")).toHaveAccessibleDescription(
          "De twee wachtwoorden zijn niet gelijk.",
        );
        await expect(page).toHaveURL(SET_PASSWORD_RESET);
      });

      await test.step("a good password signs in and leads to the start page of the role", async () => {
        await choosePassword(page, NEW_PASSWORD);
        await expect(page).toHaveURL(START_PAGE[role]);
        await expect(page.getByText(user.fullName)).toBeVisible();
      });

      await test.step("the new password works, the old one does not", async () => {
        await signOut(page);
        await signInAndWait(page, user, NEW_PASSWORD);
        await signOut(page);

        await signIn(page, user, TEST_PASSWORD);
        await expect(page.locator("form").getByRole("alert")).toHaveText(MISMATCH);
        await expect(page).toHaveURL("/login");
      });

      await test.step("the link has been used and no longer works", async () => {
        await page.goto(link);
        await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
        await expect(page).toHaveURL(/\/set-password\?mode=reset&error=link$/);
        const alert = page.getByRole("alert").filter({ hasText: LINK_INVALID });
        await expect(alert).toContainText("Vraag een nieuwe link aan.");
        await expect(page.getByRole("link", { name: "Nieuwe link aanvragen" })).toHaveAttribute(
          "href",
          "/forgot-password",
        );
        await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
      });
    });
  });
}

test.describe("forgot password: what the screen never tells", () => {
  test("an unknown, a disabled and a known address all get the same message; only the known one gets a mail", async ({
    page,
    makeUser,
  }) => {
    const known = await makeUser("backoffice");
    const disabled = await makeUser("technician", {
      isActive: false,
    });
    const unknown = `e2e-unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

    for (const email of [unknown, disabled.email, known.email]) {
      await requestLink(page, email);
      // The same text, the same link back, and the form is gone for every one of them.
      await expect(page.getByRole("link", { name: "Terug naar aanmelden" })).toBeVisible();
      await expect(visibleMain(page).getByLabel("E-mailadres")).toHaveCount(0);
    }

    // The mail for the known address was asked for last, so by the time it is here the work for
    // the earlier requests (one database lookup each, no mail) has long started. A short extra
    // wait makes sure the "no mail" checks below cannot pass just because they were too early.
    await waitForConfirmLinks(known.email, 1);
    await page.waitForTimeout(2_000);
    expect(await countMails(unknown)).toBe(0);
    expect(await countMails(disabled.email)).toBe(0);
  });

  test("an address that is not an address gets a field error, and what was typed stays", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await page.locator('form[data-hydrated="true"]:visible').waitFor();

    await page.getByRole("button", { name: "Stuur mij een link" }).click();
    await expect(page.getByLabel("E-mailadres")).toHaveAccessibleDescription(
      "Vul je e-mailadres in.",
    );

    await page.getByLabel("E-mailadres").fill("geen-adres");
    await page.getByRole("button", { name: "Stuur mij een link" }).click();
    await expect(page.getByLabel("E-mailadres")).toHaveAccessibleDescription(
      "Vul een geldig e-mailadres in.",
    );
    await expect(page.getByLabel("E-mailadres")).toHaveValue("geen-adres");
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("a link that is missing, broken or unknown shows the reset message and no form", async ({
    page,
  }) => {
    await page.goto("/auth/confirm?type=recovery");
    await expect(page).toHaveURL(/\/set-password\?mode=reset&error=link$/);
    await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toContainText(
      "Vraag een nieuwe link aan.",
    );

    // A token that Auth does not know: the page with the button shows, pressing it gives the message.
    await page.goto("/auth/confirm?token_hash=geen-geldig-token&type=recovery");
    await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
    await expect(page).toHaveURL(/\/set-password\?mode=reset&error=link$/);
    await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toBeVisible();
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
  });

  test("a link asked for before the account was disabled gives only the general message", async ({
    page,
    makeUser,
  }) => {
    const user = await makeUser("technician");
    await requestLink(page, user.email);
    const link = (await waitForConfirmLinks(user.email, 1))[0];

    await setProfileActive(user.email, false);

    await page.goto(link);
    await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
    await expect(page).toHaveURL(/\/set-password\?mode=reset&error=link$/);
    await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toBeVisible();
    // No session was left behind, and the account cannot sign in.
    await page.goto("/my-tasks");
    await expect(page).toHaveURL("/login");
    await signIn(page, user, TEST_PASSWORD);
    await expect(page.locator("form").getByRole("alert")).toHaveText(MISMATCH);
  });
});

test.describe("forgot password: the recovery session", () => {
  test("'Annuleren' ends the recovery session and leaves the old password working", async ({
    page,
    makeUser,
  }) => {
    const user = await makeUser("backoffice");
    await requestLink(page, user.email);
    await openLinkAndConfirm(page, (await waitForConfirmLinks(user.email, 1))[0]);

    await page.getByRole("button", { name: "Annuleren" }).click();
    await expect(page).toHaveURL("/login");
    await page.goto("/tasks");
    await expect(page).toHaveURL("/login");

    await signInAndWait(page, user);
  });

  test("a recovery session older than 24 hours is ended with a clear message", async ({
    page,
    makeUser,
  }) => {
    const user = await makeUser("backoffice");
    await requestLink(page, user.email);
    await openLinkAndConfirm(page, (await waitForConfirmLinks(user.email, 1))[0]);

    // The server stored the moment of the click; pretend that was 25 hours ago.
    await setRecoveryVerifiedAt(user.email, new Date(Date.now() - 25 * 60 * 60 * 1000));

    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/set-password\?mode=reset&error=expired$/);
    await expect(page.getByRole("alert").filter({ hasText: LINK_EXPIRED })).toBeVisible();
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Nieuwe link aanvragen" })).toBeVisible();
    // The session is really gone.
    await page.goto("/tasks");
    await expect(page).toHaveURL("/login");
  });

  test("other sessions of the user keep working during the reset and end when the password is set", async ({
    page,
    browser,
    baseURL,
    makeUser,
  }) => {
    const user = await makeUser("backoffice");

    // A second device that is already signed in with the old password.
    const otherDevice = await browser.newContext({ baseURL });
    const otherPage = await otherDevice.newPage();
    try {
      await signInAndWait(otherPage, user);

      await requestLink(page, user.email);
      await openLinkAndConfirm(page, (await waitForConfirmLinks(user.email, 1))[0]);

      // The recovery session is restricted; the other device is not.
      await otherPage.goto("/tasks");
      await expect(otherPage).toHaveURL("/tasks");

      await choosePassword(page, NEW_PASSWORD);
      await expect(page).toHaveURL("/tasks");

      // Now that the password changed, the other device is signed out.
      await otherPage.goto("/tasks");
      await expect(otherPage).toHaveURL("/login");
    } finally {
      await otherDevice.close();
    }
  });
});

test.describe("forgot password: two links on two devices (one recovery session each)", () => {
  /** A device that has opened its link and stands on the new password form. */
  async function deviceWithLink(
    browser: Browser,
    baseURL: string | undefined,
    link: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await openLinkAndConfirm(page, link);
    return { context, page };
  }

  test("cancelling the second session leaves the first one restricted", async ({
    browser,
    baseURL,
    page,
    makeUser,
  }) => {
    const user = await makeUser("backoffice");
    // Supabase keeps only the newest recovery token: each device confirms its link before the
    // next one is requested.
    const a = await deviceWithLink(browser, baseURL, await requestNextLink(page, user.email, 0));
    const b = await deviceWithLink(browser, baseURL, await requestNextLink(page, user.email, 1));
    try {
      await b.page.getByRole("button", { name: "Annuleren" }).click();
      await expect(b.page).toHaveURL("/login");

      // Device A is still a recovery session: it cannot open anything but the password form.
      for (const path of ["/tasks", "/"]) {
        await a.page.goto(path);
        await expect(a.page).toHaveURL(SET_PASSWORD_RESET);
      }
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("using the second session ends the first one", async ({
    browser,
    baseURL,
    page,
    makeUser,
  }) => {
    const user = await makeUser("backoffice");
    // Supabase keeps only the newest recovery token: each device confirms its link before the
    // next one is requested.
    const a = await deviceWithLink(browser, baseURL, await requestNextLink(page, user.email, 0));
    const b = await deviceWithLink(browser, baseURL, await requestNextLink(page, user.email, 1));
    try {
      await choosePassword(b.page, NEW_PASSWORD);
      await expect(b.page).toHaveURL("/tasks");

      // The password changed, so the other session is gone, restricted or not.
      await a.page.goto("/tasks");
      await expect(a.page).toHaveURL("/login");
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});

test.describe("forgot password: the new password must differ", () => {
  test("the old password is refused in a reset, and another one works", async ({
    page,
    makeUser,
  }) => {
    const user = await makeUser("technician");
    await requestLink(page, user.email);
    await openLinkAndConfirm(page, (await waitForConfirmLinks(user.email, 1))[0]);

    await choosePassword(page, TEST_PASSWORD);
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveAccessibleDescription(
      /Kies een ander wachtwoord dan je vorige\./,
    );
    await expect(page).toHaveURL(SET_PASSWORD_RESET);

    await choosePassword(page, NEW_PASSWORD);
    await expect(page).toHaveURL("/my-tasks");
  });
});
