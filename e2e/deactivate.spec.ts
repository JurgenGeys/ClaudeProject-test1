import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  createAssignedTasks,
  ensureUser,
  isAuthBlocked,
  readProfileState,
  removeTasksOf,
  removeUser,
} from "./support/users";

const MISMATCH = "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.";
const DISABLED = "Je account is uitgeschakeld. Neem contact op met kantoor.";

/**
 * A technician of this test only (own address: both projects run in parallel and the technician
 * list is shared). Removed afterwards, tasks first, so later tests see the list as before.
 */
const test = base.extend<{ technician: TestUser }>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-deactivate-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: "Bram Uitschakel",
      role: "technician",
    };
    await ensureUser(user);
    await run(user);
    await removeTasksOf(user.email);
    await removeUser(user.email);
  },
});

const rowOf = (page: Page, email: string) => page.getByRole("row", { name: new RegExp(email) });

/** Signs in as backoffice and waits for the session: `signIn` itself does not wait for the result. */
async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

/** Clicks "Uitschakelen" in the row until the dialog is open (the click does nothing before hydration). */
async function openDialogFor(page: Page, email: string, name: string | RegExp): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name });
  const trigger = rowOf(page, email).getByRole("button", { name: "Uitschakelen" });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

test.describe("switching off a technician", () => {
  test("backoffice switches a technician off: no sign-in any more, and a running session is ended", async ({
    page,
    browser,
    baseURL,
    technician,
  }) => {
    // The technician is signed in on another device while backoffice switches him off.
    const technicianContext = await browser.newContext({ baseURL });
    const technicianPage = await technicianContext.newPage();
    try {
      await signIn(technicianPage, technician);
      await expect(technicianPage).toHaveURL("/my-tasks");

      await test.step("backoffice confirms in the dialog", async () => {
        await signInAsBackoffice(page);
        await page.goto("/technicians");
        await expect(
          rowOf(page, technician.email).getByText("Actief", { exact: true }),
        ).toBeVisible();

        const dialog = await openDialogFor(page, technician.email, "Bram Uitschakel uitschakelen?");
        await expect(dialog).toContainText(
          "Hij kan zich dan niet meer aanmelden. Zijn afgewerkte taken en uren blijven bewaard.",
        );
        await dialog.getByRole("button", { name: "Uitschakelen" }).click();

        await expect(dialog).toBeHidden();
        await expect(page.getByRole("status")).toContainText(
          "Bram Uitschakel is uitgeschakeld. Zijn afgewerkte taken en uren blijven bewaard.",
        );
        const row = rowOf(page, technician.email);
        await expect(row.getByText("Uitgeschakeld", { exact: true })).toBeVisible();
        // Switched off: no "Uitschakelen" and no "Uitnodiging opnieuw versturen" any more.
        await expect(row.getByRole("button")).toHaveCount(0);
      });

      await test.step("the profile and the Auth account are both switched off", async () => {
        const state = await readProfileState(technician.email);
        expect(state?.isActive).toBe(false);
        expect(state?.deactivatedAt).toBeInstanceOf(Date);
        expect(await isAuthBlocked(technician.email)).toBe(true);
      });

      await test.step("the running session is ended at the next request, with the specific message", async () => {
        await technicianPage.goto("/my-tasks");
        await expect(technicianPage).toHaveURL("/login?reason=disabled");
        await expect(technicianPage.locator("form").getByRole("alert")).toHaveText(DISABLED);
        await technicianPage.goto("/my-tasks");
        await expect(technicianPage).toHaveURL("/login");
      });

      await test.step("signing in is refused with the general message, also with the right password", async () => {
        await signIn(technicianPage, technician);
        await expect(technicianPage.locator("form").getByRole("alert")).toHaveText(MISMATCH);
        await expect(technicianPage).toHaveURL("/login");
        await signIn(technicianPage, technician, "een-verkeerd-wachtwoord");
        await expect(technicianPage.locator("form").getByRole("alert")).toHaveText(MISMATCH);
      });
    } finally {
      await technicianContext.close();
    }
  });

  test("a technician with open tasks cannot be switched off, also not when the tasks came after the page loaded", async ({
    page,
    technician,
  }) => {
    await signInAsBackoffice(page);
    await page.goto("/technicians");
    await expect(rowOf(page, technician.email).getByText("Actief", { exact: true })).toBeVisible();

    await test.step("tasks arrive after the list was shown: the server still refuses", async () => {
      await createAssignedTasks(technician.email, BACKOFFICE.email, 2);
      const confirm = await openDialogFor(page, technician.email, "Bram Uitschakel uitschakelen?");
      await confirm.getByRole("button", { name: "Uitschakelen" }).click();

      const refusal = page.getByRole("dialog", { name: "Uitschakelen kan nog niet" });
      await expect(refusal).toContainText(
        "Bram Uitschakel heeft nog taken die niet afgewerkt zijn (2). Wijs die eerst aan een andere technieker toe.",
      );
      await expect(refusal.getByRole("link", { name: "Toon zijn taken" })).toBeVisible();
      await refusal.getByRole("button", { name: "Sluiten" }).last().click();
      await expect(refusal).toBeHidden();
    });

    await test.step("nothing changed: still active, no block in Auth, can still sign in", async () => {
      expect((await readProfileState(technician.email))?.isActive).toBe(true);
      expect(await isAuthBlocked(technician.email)).toBe(false);
    });

    await test.step("after a reload the list shows the open tasks and goes straight to the refusal", async () => {
      await page.reload();
      await expect(
        rowOf(page, technician.email).getByRole("cell", { name: "2", exact: true }),
      ).toBeVisible();
      const refusal = await openDialogFor(page, technician.email, "Uitschakelen kan nog niet");
      await expect(refusal).toContainText("(2)");
      await expect(refusal.getByRole("button", { name: "Uitschakelen" })).toHaveCount(0);
    });
  });
});
