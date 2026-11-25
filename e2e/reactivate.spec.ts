import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import { ensureUser, isAuthBlocked, readProfileState, removeUser } from "./support/users";

const MISMATCH = "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.";

/**
 * A technician of this test only (own address: both projects run in parallel and the technician
 * list is shared). Removed afterwards so later tests see the list as before.
 */
const test = base.extend<{ technician: TestUser }>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-reactivate-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: "Tom Heractiveer",
      role: "technician",
    };
    await ensureUser(user);
    await run(user);
    await removeUser(user.email);
  },
});

const rowOf = (page: Page, email: string) => page.getByRole("row", { name: new RegExp(email) });

/** Signs in as backoffice and waits for the session: `signIn` itself does not wait for the result. */
async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

/**
 * Clicks the button of this name in the row until the dialog is open (the click does nothing
 * before hydration). `getByRole` only finds visible elements, so a hidden dialog or form that
 * an earlier client-side navigation left in the DOM is never matched.
 */
async function openDialogFor(
  page: Page,
  email: string,
  button: string,
  dialogName: string,
): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: dialogName });
  const trigger = rowOf(page, email).getByRole("button", { name: button });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

test.describe("switching a technician on again", () => {
  test("backoffice switches a technician off and on again: he can sign in again and shows as Actief", async ({
    page,
    browser,
    baseURL,
    technician,
  }) => {
    const technicianContext = await browser.newContext({ baseURL });
    const technicianPage = await technicianContext.newPage();
    try {
      await signInAsBackoffice(page);
      await page.goto("/technicians");
      await expect(rowOf(page, technician.email).getByText("Actief")).toBeVisible();

      await test.step("backoffice switches him off", async () => {
        const dialog = await openDialogFor(
          page,
          technician.email,
          "Uitschakelen",
          "Tom Heractiveer uitschakelen?",
        );
        await dialog.getByRole("button", { name: "Uitschakelen" }).click();
        await expect(dialog).toBeHidden();
        await expect(rowOf(page, technician.email).getByText("Uitgeschakeld")).toBeVisible();
        expect(await isAuthBlocked(technician.email)).toBe(true);
      });

      await test.step("he cannot sign in", async () => {
        await signIn(technicianPage, technician);
        await expect(technicianPage.locator("form").getByRole("alert")).toHaveText(MISMATCH);
        await expect(technicianPage).toHaveURL("/login");
      });

      await test.step("the dialog explains what happens and can be cancelled", async () => {
        const dialog = await openDialogFor(
          page,
          technician.email,
          "Opnieuw activeren",
          "Tom Heractiveer opnieuw activeren?",
        );
        await expect(dialog).toContainText(
          'Hij kan zich dan weer aanmelden met zijn vorige wachtwoord. Weet hij dat niet meer, dan gebruikt hij "Wachtwoord vergeten" op het aanmeldscherm.',
        );
        await dialog.getByRole("button", { name: "Annuleren" }).click();
        await expect(dialog).toBeHidden();
        expect((await readProfileState(technician.email))?.isActive).toBe(false);
        expect(await isAuthBlocked(technician.email)).toBe(true);
      });

      await test.step("backoffice confirms: confirmation message and status Actief", async () => {
        const dialog = await openDialogFor(
          page,
          technician.email,
          "Opnieuw activeren",
          "Tom Heractiveer opnieuw activeren?",
        );
        await dialog.getByRole("button", { name: "Opnieuw activeren" }).click();

        await expect(dialog).toBeHidden();
        await expect(page.getByRole("status")).toContainText(
          "Tom Heractiveer is opnieuw actief. Je kan hem weer taken toewijzen.",
        );
        const row = rowOf(page, technician.email);
        await expect(row.getByText("Actief", { exact: true })).toBeVisible();
        await expect(row.getByRole("button", { name: "Opnieuw activeren" })).toHaveCount(0);
        await expect(row.getByRole("button", { name: "Uitschakelen" })).toBeVisible();
      });

      await test.step("the profile and the Auth account are both switched on again", async () => {
        const state = await readProfileState(technician.email);
        expect(state).toEqual({ isActive: true, deactivatedAt: null });
        expect(await isAuthBlocked(technician.email)).toBe(false);
      });

      await test.step("he signs in again with his existing password", async () => {
        await signIn(technicianPage, technician);
        await expect(technicianPage).toHaveURL("/my-tasks");
      });

      await test.step("after a reload the list still shows him as Actief", async () => {
        await page.reload();
        await expect(
          rowOf(page, technician.email).getByText("Actief", { exact: true }),
        ).toBeVisible();
      });
    } finally {
      await technicianContext.close();
    }
  });

  test("switching on is refused, with a clear message, when he was already switched on in the meantime", async ({
    page,
    technician,
  }) => {
    // Start from a switched-off technician, as the list will show him.
    await ensureUser({ ...technician, isActive: false, banned: true });
    await signInAsBackoffice(page);
    await page.goto("/technicians");
    await expect(rowOf(page, technician.email).getByText("Uitgeschakeld")).toBeVisible();

    const dialog = await openDialogFor(
      page,
      technician.email,
      "Opnieuw activeren",
      "Tom Heractiveer opnieuw activeren?",
    );
    // Somebody else switched him on while this dialog was open.
    await ensureUser(technician);
    await dialog.getByRole("button", { name: "Opnieuw activeren" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "Tom Heractiveer is al actief. Laad de pagina opnieuw.",
    );
    await expect(dialog).toBeVisible();
    expect(await readProfileState(technician.email)).toEqual({
      isActive: true,
      deactivatedAt: null,
    });
  });
});
