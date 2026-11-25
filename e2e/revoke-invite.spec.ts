import { test as base, expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import { waitForConfirmLinks } from "./support/mailbox";
import { signIn } from "./support/sign-in";
import { BACKOFFICE } from "./support/test-users";
import {
  authAccountExists,
  createRevokedLeftover,
  isAuthBlocked,
  markInviteAccepted,
  readProfileState,
  removeUser,
} from "./support/users";

const LINK_INVALID = "Deze link is niet meer geldig.";

/**
 * An address of this test only (both projects run in parallel and the technician list is
 * shared). Whatever the test leaves behind is removed afterwards.
 */
const test = base.extend<{ inviteeEmail: string }>({
  // Playwright requires an object pattern as first argument; this fixture uses no other fixtures.
  inviteeEmail: async ({}, run, testInfo: TestInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const email = `e2e-revoke-${testInfo.project.name}-${Date.now()}-${random}@example.com`;
    await run(email);
    await removeUser(email);
  },
});

const rowOf = (page: Page, email: string) => page.getByRole("row", { name: new RegExp(email) });

async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

/** Adds a technician through the dialog in B7 and waits until he is in the list as "Uitgenodigd". */
async function inviteViaDialog(page: Page, email: string): Promise<void> {
  await page.goto("/technicians");
  const dialog = page.getByRole("dialog", { name: "Technieker toevoegen" });
  const trigger = page.getByRole("button", { name: "Technieker toevoegen" });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await dialog.locator('form[data-hydrated="true"]:visible').waitFor();
  await dialog.getByLabel(/^Naam/).fill("Yana Intrekken");
  await dialog.getByLabel(/^E-mailadres/).fill(email);
  await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();
  await expect(dialog).toBeHidden();
  await expect(rowOf(page, email).getByText("Uitgenodigd")).toBeVisible();
}

/** Clicks "Uitnodiging intrekken" in the row until the dialog is open (no effect before hydration). */
async function openRevokeDialog(page: Page, email: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: "De uitnodiging van Yana Intrekken intrekken?" });
  const trigger = rowOf(page, email).getByRole("button", {
    name: "Uitnodiging van Yana Intrekken intrekken",
  });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

test.describe("revoking an invitation", () => {
  test("backoffice revokes an invitation: the link no longer works and the technician is gone from the list", async ({
    page,
    inviteeEmail: email,
  }) => {
    let link: string;
    await test.step("backoffice invites a technician and sees the button in his row", async () => {
      await signInAsBackoffice(page);
      await inviteViaDialog(page, email);
      link = (await waitForConfirmLinks(email, 1))[0];
      await expect(
        rowOf(page, email).getByRole("button", {
          name: "Uitnodiging van Yana Intrekken intrekken",
        }),
      ).toBeVisible();
    });

    await test.step("'Annuleren' leaves everything as it was", async () => {
      const dialog = await openRevokeDialog(page, email);
      await expect(dialog).toContainText("De link in de mail werkt dan niet meer");
      await dialog.getByRole("button", { name: "Annuleren" }).click();
      await expect(dialog).toBeHidden();
      await expect(rowOf(page, email).getByText("Uitgenodigd")).toBeVisible();
    });

    await test.step("confirming removes him from the list with a message", async () => {
      const dialog = await openRevokeDialog(page, email);
      await dialog.getByRole("button", { name: "Uitnodiging intrekken" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("status")).toContainText(
        "De uitnodiging van Yana Intrekken is ingetrokken. De link in de mail werkt niet meer.",
      );
      await expect(rowOf(page, email)).toHaveCount(0);
      await page.reload();
      await expect(rowOf(page, email)).toHaveCount(0);
    });

    await test.step("profile and Auth account are gone", async () => {
      expect(await readProfileState(email)).toBeUndefined();
      expect(await authAccountExists(email)).toBe(false);
    });

    await test.step("the link from the mail no longer works", async () => {
      await page.getByRole("button", { name: "Uitloggen" }).click();
      await expect(page).toHaveURL("/login");
      await page.goto(link);
      await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
      await expect(page).toHaveURL(/\/set-password\?mode=invite&error=link$/);
      await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toBeVisible();
      await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
      await page.goto("/my-tasks");
      await expect(page).toHaveURL("/login");
    });

    await test.step("the same address can be invited again afterwards", async () => {
      await signInAsBackoffice(page);
      await inviteViaDialog(page, email);
    });
  });

  test("a stale list: when the technician accepted in the meantime, revoking is refused", async ({
    page,
    inviteeEmail: email,
  }) => {
    await signInAsBackoffice(page);
    await inviteViaDialog(page, email);
    await page.reload();
    const dialog = await openRevokeDialog(page, email);

    // He chose a password after the list was loaded.
    await markInviteAccepted(email);
    await dialog.getByRole("button", { name: "Uitnodiging intrekken" }).click();

    await expect(dialog.getByRole("alert")).toContainText(
      "Yana Intrekken heeft al een wachtwoord gekozen en kan niet meer ingetrokken worden. Laad de pagina opnieuw.",
    );
    await expect(dialog).toBeVisible();
    // Nothing was removed.
    expect((await readProfileState(email))?.isActive).toBe(true);
    expect(await authAccountExists(email)).toBe(true);

    await page.reload();
    await expect(rowOf(page, email).getByText("Actief", { exact: true })).toBeVisible();
    await expect(
      rowOf(page, email).getByRole("button", { name: "Uitnodiging van Yana Intrekken intrekken" }),
    ).toHaveCount(0);
  });

  test("a blocked Auth account without a profile (left by a failed delete) gets a working link after a new invitation", async ({
    page,
    inviteeEmail: email,
  }) => {
    await createRevokedLeftover(email);
    expect(await isAuthBlocked(email)).toBe(true);
    expect(await readProfileState(email)).toBeUndefined();

    await signInAsBackoffice(page);
    await inviteViaDialog(page, email);
    expect(await isAuthBlocked(email)).toBe(false);
    await page.getByRole("button", { name: "Uitloggen" }).click();
    await expect(page).toHaveURL("/login");

    // The newest mail is the one of the new invitation.
    const link = (await waitForConfirmLinks(email, 2))[0];
    await page.goto(link);
    await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
    await expect(page).toHaveURL(/\/set-password\?mode=invite$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welkom, Yana" })).toBeVisible();
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toBeVisible();
  });
});
