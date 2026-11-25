import { test as base, expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import { assertLocalSupabase } from "../src/lib/supabase/local-only";

import { waitForConfirmLinks } from "./support/mailbox";
import { signIn } from "./support/sign-in";
import { BACKOFFICE, TECHNICIAN } from "./support/test-users";
import { removeUser, setInviteVerifiedAt } from "./support/users";

const NOT_FOR_YOU = "Deze pagina is niet voor jou bedoeld";
const LINK_INVALID = "Deze link is niet meer geldig.";
const LINK_EXPIRED = "De link is verlopen. Vraag kantoor om een nieuwe uitnodiging.";
const SET_PASSWORD_INVITE = /\/set-password\?mode=invite$/;
const PASSWORD = "Een-nieuw-wachtwoord-2026";

/**
 * `inviteeEmail` is an address that no other test and no earlier run uses (both projects run in
 * parallel). The technician that a test invites under it is removed again afterwards, so the
 * technician list of later tests (and later build tasks) is not influenced.
 */
const test = base.extend<{ inviteeEmail: string }>({
  // Playwright requires an object pattern as first argument; this fixture uses no other fixtures.
  inviteeEmail: async ({}, run, testInfo: TestInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const email = `e2e-invite-${testInfo.project.name}-${Date.now()}-${random}@example.com`;
    await run(email);
    await removeUser(email);
  },
});

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL("/login");
}

/** Signs in as backoffice and waits for the session: `signIn` itself does not wait for the result. */
async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
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

/** Backoffice adds a technician in the dialog and waits for the confirmation. */
async function inviteViaDialog(page: Page, email: string): Promise<void> {
  const dialog = await openAddDialog(page);
  await dialog.getByLabel(/^Naam/).fill("Yana Test");
  await dialog.getByLabel(/^E-mailadres/).fill(email);
  await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText(`Uitnodiging verstuurd naar ${email}.`);
  await expect(rowOf(page, email).getByText("Uitgenodigd")).toBeVisible();
}

/** Presses "Uitnodiging opnieuw versturen" until it works (Auth has a minimum interval between mails). */
async function resendViaRow(page: Page, email: string): Promise<void> {
  const resend = rowOf(page, email).getByRole("button", { name: "Uitnodiging opnieuw versturen" });
  await expect(async () => {
    await resend.click();
    await expect(page.getByRole("status")).toContainText(
      `Uitnodiging opnieuw verstuurd naar ${email}.`,
      { timeout: 5_000 },
    );
  }).toPass({ timeout: 30_000 });
}

/** Opens the link from the mail and presses the button on the page it leads to. */
async function openLinkAndConfirm(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await expect(page).toHaveURL(/\/auth\/confirm\?/);
  await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
  await expect(page).toHaveURL(SET_PASSWORD_INVITE);
  await expect(page.getByRole("heading", { level: 1, name: "Welkom, Yana" })).toBeVisible();
  await page.locator('form[data-hydrated="true"]').waitFor();
}

async function choosePassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(password);
  await page.getByLabel("Herhaal wachtwoord").fill(password);
  await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
  await expect(page).toHaveURL("/my-tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Mijn taken" })).toBeVisible();
}

test.describe("inviting a technician", () => {
  test("backoffice invites a technician, who chooses a password through the mail and lands on Mijn taken", async ({
    page,
    request,
    inviteeEmail: email,
  }) => {
    await test.step("backoffice adds the technician", async () => {
      await signInAsBackoffice(page);
      await inviteViaDialog(page, email);
      await expect(rowOf(page, email).getByText("Yana Test")).toBeVisible();
    });

    let link: string;
    await test.step("the invitation can be sent again, and the newest mail has the link", async () => {
      await resendViaRow(page, email);
      const links = await waitForConfirmLinks(email, 2);
      link = links[0];
      // The link goes to our own confirm page on the configured site, with a token.
      expect(new URL(link).pathname).toBe("/auth/confirm");
      expect(new URL(link).searchParams.get("type")).toBe("invite");
      expect(new URL(link).searchParams.get("token_hash")).toBeTruthy();
      await signOut(page);
    });

    await test.step("a mail scanner that fetches the link does not use it up", async () => {
      expect((await request.get(link)).ok()).toBe(true);
      expect((await request.get(link)).ok()).toBe(true);
      expect((await request.head(link)).ok()).toBe(true);
      // Nothing was verified: there is no session.
      await page.goto("/my-tasks");
      await expect(page).toHaveURL("/login");
    });

    await test.step("the link leads to a page with a button; pressing it leads to set password", async () => {
      await page.goto(link);
      await expect(page).toHaveURL(/\/auth\/confirm\?/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Welkom bij de planning" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
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

      await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(PASSWORD);
      await page.getByLabel("Herhaal wachtwoord").fill(`${PASSWORD}-anders`);
      await page.getByRole("button", { name: "Wachtwoord bewaren" }).click();
      await expect(page.getByLabel("Herhaal wachtwoord")).toHaveAccessibleDescription(
        "De twee wachtwoorden zijn niet gelijk.",
      );
      await expect(page).toHaveURL(SET_PASSWORD_INVITE);
    });

    await test.step("a good password signs the technician in on Mijn taken", async () => {
      await choosePassword(page, PASSWORD);
      await expect(page.getByText("Yana Test")).toBeVisible();
    });

    await test.step("the new password works for signing in later", async () => {
      await signOut(page);
      await signIn(page, { email }, PASSWORD);
      await expect(page).toHaveURL("/my-tasks");
      await signOut(page);
    });

    await test.step("backoffice now sees the technician as active, without a resend button", async () => {
      await signInAsBackoffice(page);
      await page.goto("/technicians");
      await expect(rowOf(page, email).getByText("Actief", { exact: true })).toBeVisible();
      await expect(rowOf(page, email).getByRole("button")).toHaveCount(0);
      await signOut(page);
    });

    await test.step("the link has been used and no longer works", async () => {
      await page.goto(link);
      await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
      await expect(page).toHaveURL(/\/set-password\?mode=invite&error=link$/);
      await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toContainText(
        "Vraag kantoor om een nieuwe uitnodiging.",
      );
      await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
    });
  });

  test("a link that was already opened can be sent again, and 'Annuleren' leaves the temporary session", async ({
    page,
    inviteeEmail: email,
  }) => {
    let firstLink: string;
    await test.step("the technician opens the link but does not choose a password", async () => {
      await signInAsBackoffice(page);
      await inviteViaDialog(page, email);
      firstLink = (await waitForConfirmLinks(email, 1))[0];
      await signOut(page);

      await openLinkAndConfirm(page, firstLink);
      await page.getByRole("button", { name: "Annuleren" }).click();
      await expect(page).toHaveURL("/login");
      await page.goto("/my-tasks");
      await expect(page).toHaveURL("/login");
    });

    let secondLink: string;
    await test.step("backoffice sends the invitation again: a new link arrives", async () => {
      await signInAsBackoffice(page);
      await page.goto("/technicians");
      await expect(rowOf(page, email).getByText("Uitgenodigd")).toBeVisible();
      await resendViaRow(page, email);
      secondLink = (await waitForConfirmLinks(email, 2))[0];
      expect(secondLink).not.toBe(firstLink);
      expect(new URL(secondLink).pathname).toBe("/auth/confirm");
      expect(new URL(secondLink).searchParams.get("token_hash")).toBeTruthy();
      await signOut(page);
    });

    await test.step("the new link still lets the technician choose a password", async () => {
      await openLinkAndConfirm(page, secondLink);
      await choosePassword(page, PASSWORD);
    });
  });

  test("a temporary session older than 24 hours is ended with a clear message", async ({
    page,
    inviteeEmail: email,
  }) => {
    await signInAsBackoffice(page);
    await inviteViaDialog(page, email);
    const link = (await waitForConfirmLinks(email, 1))[0];
    await signOut(page);
    await openLinkAndConfirm(page, link);

    // The server stored the moment of verification; pretend that was 25 hours ago.
    await setInviteVerifiedAt(email, new Date(Date.now() - 25 * 60 * 60 * 1000));

    await page.goto("/my-tasks");
    await expect(page).toHaveURL(/\/set-password\?mode=invite&error=expired$/);
    await expect(page.getByRole("alert").filter({ hasText: LINK_EXPIRED })).toBeVisible();
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
    // The session is really gone.
    await page.goto("/my-tasks");
    await expect(page).toHaveURL("/login");
  });

  test("an invalid or missing link shows the message and no form", async ({ page }) => {
    for (const path of [
      "/auth/confirm",
      "/auth/confirm?type=invite",
      "/auth/confirm?token_hash=geen-geldig-token",
      // Only invitations (and their resend) are accepted until BT-06b adds password reset.
      "/auth/confirm?token_hash=geen-geldig-token&type=signup",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/set-password\?mode=invite&error=link$/);
      await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toContainText(
        "Vraag kantoor om een nieuwe uitnodiging.",
      );
      await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveCount(0);
    }

    // A token that Auth does not know: the page with the button shows, pressing it gives the message.
    await page.goto("/auth/confirm?token_hash=geen-geldig-token&type=invite");
    await page.getByRole("button", { name: "Wachtwoord instellen" }).click();
    await expect(page).toHaveURL(/\/set-password\?mode=invite&error=link$/);
    await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toBeVisible();

    // Opening the page itself, without a link, says the same.
    await page.goto("/set-password");
    await expect(page.getByRole("alert").filter({ hasText: LINK_INVALID })).toBeVisible();
  });

  test("nobody can register by themselves", async () => {
    assertLocalSupabase(process.env);
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      },
      body: JSON.stringify({ email: `e2e-signup-${Date.now()}@example.com`, password: PASSWORD }),
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
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
    await signInAsBackoffice(page);
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
