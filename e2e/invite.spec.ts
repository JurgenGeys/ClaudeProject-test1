import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { waitForConfirmLinks } from "./support/mailbox";
import { signIn } from "./support/sign-in";
import { BACKOFFICE, TECHNICIAN } from "./support/test-users";

const NOT_FOR_YOU = "Deze pagina is niet voor jou bedoeld";
const LINK_INVALID = "Deze link is niet meer geldig.";
const SET_PASSWORD_INVITE = /\/set-password\?mode=invite$/;

// Next.js has its own role="alert" (route announcer), so the tests look for the message in a
// dialog, or by its text.

/** An address that no other test and no earlier run uses (both projects run in parallel). */
function uniqueEmail(testInfo: TestInfo): string {
  return `e2e-invite-${testInfo.project.name}-${Date.now()}@example.com`;
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL("/login");
}

/** Opens B7 and the "Technieker toevoegen" dialog, retrying the click until React is attached. */
async function openAddDialog(page: Page): Promise<Locator> {
  await page.goto("/technicians");
  const dialog = page.getByRole("dialog", { name: "Technieker toevoegen" });
  const trigger = page.getByRole("button", { name: "Technieker toevoegen" });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await dialog.locator('form[data-hydrated="true"]').waitFor();
  return dialog;
}

const rowOf = (page: Page, email: string) => page.getByRole("row", { name: new RegExp(email) });

test.describe("inviting a technician", () => {
  test("backoffice invites a technician, who chooses a password through the mail and lands on Mijn taken", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo);
    const password = "Een-nieuw-wachtwoord-2026";

    await test.step("backoffice adds the technician", async () => {
      await signIn(page, BACKOFFICE);
      await expect(page).toHaveURL("/tasks");
      const dialog = await openAddDialog(page);
      await dialog.getByLabel(/^Naam/).fill("Yana Test");
      await dialog.getByLabel(/^E-mailadres/).fill(email);
      await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByRole("status")).toContainText(`Uitnodiging verstuurd naar ${email}.`);
      await expect(rowOf(page, email).getByText("Uitgenodigd")).toBeVisible();
      await expect(rowOf(page, email).getByText("Yana Test")).toBeVisible();
    });

    let link: string;
    await test.step("the invitation can be sent again, and the newest mail has the link", async () => {
      const resend = rowOf(page, email).getByRole("button", {
        name: "Uitnodiging opnieuw versturen",
      });
      // Auth refuses a second mail within its minimum interval (1 second locally, 60 seconds in
      // a real project) and the page then says so; trying again after a moment is what a user does.
      await expect(async () => {
        await resend.click();
        await expect(page.getByRole("status")).toContainText(
          `Uitnodiging opnieuw verstuurd naar ${email}.`,
          { timeout: 5_000 },
        );
      }).toPass({ timeout: 30_000 });
      const links = await waitForConfirmLinks(email, 2);
      link = links[0];
      // The link goes to our own confirm route on the configured site, with a token.
      expect(new URL(link).pathname).toBe("/auth/confirm");
      expect(new URL(link).searchParams.get("type")).toBe("invite");
      expect(new URL(link).searchParams.get("token_hash")).toBeTruthy();
      await signOut(page);
    });

    await test.step("the link leads to the set password page, where nothing else is reachable", async () => {
      await page.goto(link);
      await expect(page).toHaveURL(SET_PASSWORD_INVITE);
      await expect(page.getByRole("heading", { level: 1, name: "Welkom, Yana" })).toBeVisible();
      await page.locator('form[data-hydrated="true"]').waitFor();

      // The temporary session may only be used to choose the password.
      for (const path of ["/my-tasks", "/tasks", "/technicians", "/"]) {
        await page.goto(path);
        await expect(page).toHaveURL(SET_PASSWORD_INVITE);
      }
      await page.locator('form[data-hydrated="true"]').waitFor();
    });

    await test.step("a short password and two different passwords are refused", async () => {
      await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill("kort");
      await page.getByLabel("Herhaal wachtwoord").fill("kort");
      await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
      await expect(
        page.getByLabel("Nieuw wachtwoord", { exact: true }),
      ).toHaveAccessibleDescription(/Je wachtwoord moet minstens 8 tekens hebben\./);

      await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(password);
      await page.getByLabel("Herhaal wachtwoord").fill(`${password}-anders`);
      await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
      await expect(page.getByLabel("Herhaal wachtwoord")).toHaveAccessibleDescription(
        "De twee wachtwoorden zijn niet gelijk.",
      );
      await expect(page).toHaveURL(SET_PASSWORD_INVITE);
    });

    await test.step("a good password signs the technician in on Mijn taken", async () => {
      await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(password);
      await page.getByLabel("Herhaal wachtwoord").fill(password);
      await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
      await expect(page).toHaveURL("/my-tasks");
      await expect(page.getByRole("heading", { level: 1, name: "Mijn taken" })).toBeVisible();
      await expect(page.getByText("Yana Test")).toBeVisible();
    });

    await test.step("the new password works for signing in later", async () => {
      await signOut(page);
      await signIn(page, { email }, password);
      await expect(page).toHaveURL("/my-tasks");
      await signOut(page);
    });

    await test.step("backoffice now sees the technician as active, without a resend button", async () => {
      await signIn(page, BACKOFFICE);
      await page.goto("/technicians");
      await expect(rowOf(page, email).getByText("Actief", { exact: true })).toBeVisible();
      await expect(rowOf(page, email).getByRole("button")).toHaveCount(0);
      await signOut(page);
    });

    await test.step("the link has been used and no longer works", async () => {
      await page.goto(link);
      await expect(page).toHaveURL(/\/set-password\?mode=invite&error=link$/);
      await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toContainText(
        "Vraag kantoor om een nieuwe uitnodiging.",
      );
      await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
    });
  });

  test("an invalid or missing link shows the message and no form", async ({ page }) => {
    for (const path of [
      "/auth/confirm?token_hash=geen-geldig-token&type=invite",
      "/auth/confirm?type=invite",
      "/auth/confirm",
      // Only invitations are accepted until BT-06b adds password reset.
      "/auth/confirm?token_hash=geen-geldig-token&type=recovery",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/set-password\?mode=invite&error=link$/);
      await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toContainText(
        "Vraag kantoor om een nieuwe uitnodiging.",
      );
      await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
    }

    // Opening the page itself, without a link, says the same.
    await page.goto("/set-password");
    await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toBeVisible();
  });

  test("a technician cannot open the technician list", async ({ page }) => {
    await signIn(page, TECHNICIAN);
    await expect(page).toHaveURL("/my-tasks");
    await page.goto("/technicians");
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOR_YOU })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Techniekers" })).toHaveCount(0);
    await expect(page.getByText(BACKOFFICE.email)).toHaveCount(0);
    await expect(page.getByText(TECHNICIAN.email)).toHaveCount(0);
  });

  test("the dialog refuses empty fields and an address that is already in use", async ({
    page,
  }) => {
    await signIn(page, BACKOFFICE);
    const dialog = await openAddDialog(page);

    await test.step("empty fields", async () => {
      await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Vul de 2 gemarkeerde velden in.");
      await expect(dialog.getByLabel(/^Naam/)).toHaveAccessibleDescription("Vul de naam in.");
      await expect(dialog.getByLabel(/^E-mailadres/)).toHaveAccessibleDescription(
        "Vul een geldig e-mailadres in.",
      );
    });

    await test.step("an address of a technician, in other capitals", async () => {
      await dialog.getByLabel(/^Naam/).fill("Kevin Dubbel");
      await dialog.getByLabel(/^E-mailadres/).fill(TECHNICIAN.email.toUpperCase());
      await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();
      await expect(dialog.getByLabel(/^E-mailadres/)).toHaveAccessibleDescription(
        "Er bestaat al een gebruiker met dit e-mailadres.",
      );
      // What was typed stays, and the dialog stays open.
      await expect(dialog.getByLabel(/^Naam/)).toHaveValue("Kevin Dubbel");
    });

    await test.step("the address of a backoffice user cannot become a technician either", async () => {
      await dialog.getByLabel(/^E-mailadres/).fill(BACKOFFICE.email);
      await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();
      await expect(dialog.getByLabel(/^E-mailadres/)).toHaveAccessibleDescription(
        "Er bestaat al een gebruiker met dit e-mailadres.",
      );
    });

    await dialog.getByRole("button", { name: "Annuleren" }).click();
    await expect(dialog).toBeHidden();
    // Nothing was added: the backoffice user is not in the technician list.
    await expect(page.getByRole("row", { name: new RegExp(BACKOFFICE.email) })).toHaveCount(0);
  });
});
