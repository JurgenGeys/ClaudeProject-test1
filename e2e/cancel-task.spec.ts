import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  cancelTaskAsOffice,
  changeTaskInstructions,
  createCustomer,
  createOpenTask,
  createTasksWithStatus,
  ensureUser,
  pickUpTaskBehindTheBack,
  readTaskCancellation,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

// "Taak annuleren" (BT-14b) in B3: the office cancels an Open or Toegewezen task with an optional
// reason, and the technician no longer has it. Every test makes its own technician, customer and
// tasks, and removes them afterwards. A colleague or the technician acts "behind the back" of the
// open page through the database. The file runs on the laptop and the phone project (B3 is laptop
// first but usable on a phone).

type Fixtures = {
  kevin: TestUser;
  token: string;
};

const test = base.extend<Fixtures>({
  kevin: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-cancel-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Kevin Annuleer ${random}`,
      role: "technician",
    };
    await ensureUser(user);
    await run(user);
    await removeTasksOf(user.email);
    await removeUser(user.email);
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxcancel${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

async function customerOf(token: string, name: string): Promise<string> {
  return createCustomer(`${token} ${name}`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
}

/** A Toegewezen task of Kevin, planned on 10 March 2031. */
async function assignedTask(token: string, kevin: TestUser, name = "Bakkerij"): Promise<number> {
  const customer = await customerOf(token, name);
  const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
    { status: "assigned", scheduledDate: "2031-03-10", startTime: "08:00" },
  ]);
  return number;
}

/** Signs in, waits for the redirect (a goto before it can cancel the sign-in), opens B3. */
async function openTask(page: Page, number: number): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
  await page.goto(`/tasks/${number}`);
  await expect(page).toHaveURL(`/tasks/${number}`);
  await expect(page.getByText(`Taak #${number}`, { exact: true })).toBeVisible();
}

/** Everything is looked up among the visible elements: Next keeps the previous route hidden in the DOM. */
const visible = (locator: Locator) => locator.filter({ visible: true });
const openButton = (page: Page) =>
  visible(page.getByRole("button", { name: "Taak annuleren", exact: true }));
const dialogOf = (page: Page, number: number) =>
  page.getByRole("dialog", { name: `Taak #${number} annuleren?` });

/**
 * The height that the stylesheet gives the element. Not `boundingBox()`: that includes the
 * zoom-in animation of the dialog and measures 39,9 px for a 40 px button.
 */
async function expectTapTarget(locator: Locator, minimum: number): Promise<void> {
  const height = await locator.evaluate((element) => parseFloat(getComputedStyle(element).height));
  expect(height).toBeGreaterThanOrEqual(minimum);
}

/** Taps the button until the dialog is open (a tap does nothing before the page is hydrated). */
async function openDialog(page: Page, number: number): Promise<Locator> {
  const dialog = dialogOf(page, number);
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await openButton(page).click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

const CHANGED = "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.";

test.describe("Taak annuleren (B3)", () => {
  test("the office cancels a Toegewezen task with a reason; the technician no longer has it", async ({
    page,
    token,
    kevin,
  }) => {
    const number = await assignedTask(token, kevin);
    await openTask(page, number);

    await test.step("the dialog has the texts of the design, with the technician", async () => {
      const dialog = await openDialog(page, number);
      await expect(dialog).toContainText(
        `Gebruik dit als de afspraak niet meer doorgaat, bv. omdat de klant afzegt. De taak verdwijnt uit de planning en uit de lijst van ${kevin.fullName}. Ze blijft bewaard onder "Geannuleerd".`,
      );
      await expect(dialog).toContainText(
        "Annuleren kan je niet ongedaan maken. Moet het werk toch gebeuren, maak dan een nieuwe taak aan.",
      );
      await expect(dialog.getByLabel(/Reden/)).toHaveAttribute(
        "placeholder",
        "Bv. klant heeft zelf afgezegd",
      );
    });

    await test.step("Escape closes it without a change and gives the focus back", async () => {
      await page.keyboard.press("Escape");
      await expect(dialogOf(page, number)).toHaveCount(0);
      await expect(openButton(page)).toBeFocused();
      expect((await readTaskCancellation(number)).status).toBe("assigned");
    });

    await test.step("'Taak behouden' closes it without a change, and the reason is gone next time", async () => {
      const dialog = await openDialog(page, number);
      await dialog.getByLabel(/Reden/).fill("Dit wordt niet bewaard");
      await dialog.getByRole("button", { name: "Taak behouden" }).click();
      await expect(dialogOf(page, number)).toHaveCount(0);
      expect((await readTaskCancellation(number)).status).toBe("assigned");
      const again = await openDialog(page, number);
      await expect(again.getByLabel(/Reden/)).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(dialogOf(page, number)).toHaveCount(0);
    });

    await test.step("confirming cancels the task with the reason", async () => {
      const dialog = await openDialog(page, number);
      await dialog.getByLabel(/Reden/).fill("Klant heeft zelf afgezegd");
      await dialog.getByRole("button", { name: "Taak annuleren" }).click();

      await expect(page.getByRole("status")).toContainText(`Taak #${number} is geannuleerd.`);
      await expect(dialogOf(page, number)).toHaveCount(0);
      // The parameter of the confirmation is removed from the address, so a reload is quiet.
      await expect(page).toHaveURL(`/tasks/${number}`);
      await expect(page.getByText("Geannuleerd", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(new RegExp(`Deze taak is geannuleerd op .+ door ${BACKOFFICE.fullName}\\.`)),
      ).toBeVisible();
      await expect(page.getByText("Reden: Klant heeft zelf afgezegd")).toBeVisible();
      // A cancelled task is read only.
      await expect(page.getByRole("button", { name: "Taak annuleren" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Bewerken" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Terugzetten" })).toHaveCount(0);

      const saved = await readTaskCancellation(number);
      expect(saved).toMatchObject({
        status: "cancelled",
        cancelledByEmail: BACKOFFICE.email.toLowerCase(),
        cancellationReason: "Klant heeft zelf afgezegd",
        // The technician stays on the task for the history.
        assigneeEmail: kevin.email.toLowerCase(),
        pickedUpAt: null,
        updatedByEmail: BACKOFFICE.email.toLowerCase(),
      });
      expect(saved.cancelledAt).not.toBeNull();
    });

    await test.step("the confirmation is gone after a reload, the grey bar stays", async () => {
      await page.reload();
      await expect(page.getByText("Reden: Klant heeft zelf afgezegd")).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
    });

    await test.step("the edit page of a cancelled task only gives the reason", async () => {
      await page.goto(`/tasks/${number}/edit`);
      await expect(
        page.getByText("Deze taak is geannuleerd en kan niet meer bewerkt worden."),
      ).toBeVisible();
    });

    await test.step("the technician no longer sees it in his list, and its page says it was cancelled", async () => {
      await page.getByRole("button", { name: "Uitloggen" }).click();
      await signIn(page, kevin);
      await expect(page).toHaveURL("/my-tasks");
      await expect(page.getByText(`#${number}`)).toHaveCount(0);
      await page.goto(`/my-tasks/${number}`);
      await expect(page).toHaveURL(`/my-tasks/${number}`);
      await expect(
        visible(
          page.getByRole("heading", { level: 1, name: "Deze taak is geannuleerd door kantoor." }),
        ),
      ).toBeVisible();
      await expect(
        visible(page.getByRole("button", { name: "Oppikken", exact: true })),
      ).toHaveCount(0);
    });
  });

  test("an Open task is cancelled without a reason; the text has no technician", async ({
    page,
    token,
  }) => {
    const customer = await customerOf(token, "Open");
    const number = await createOpenTask(BACKOFFICE.email, customer, "2031-03-10");
    await openTask(page, number);

    const dialog = await openDialog(page, number);
    await expect(dialog).toContainText(
      'De taak verdwijnt uit de planning. Ze blijft bewaard onder "Geannuleerd".',
    );
    await expect(dialog).not.toContainText("uit de lijst van");
    await dialog.getByRole("button", { name: "Taak annuleren" }).click();

    await expect(page.getByRole("status")).toContainText(`Taak #${number} is geannuleerd.`);
    await expect(page.getByText(/Deze taak is geannuleerd op .+ door /)).toBeVisible();
    await expect(page.getByText(/^Reden:/)).toHaveCount(0);
    expect(await readTaskCancellation(number)).toMatchObject({
      status: "cancelled",
      cancellationReason: null,
      assigneeEmail: null,
    });
  });

  test("the dialog works with the keyboard and has tap targets that are big enough", async ({
    page,
    token,
    kevin,
    isMobile,
  }) => {
    const number = await assignedTask(token, kevin);
    await openTask(page, number);
    await expectTapTarget(openButton(page), isMobile ? 44 : 40);

    await openButton(page).focus();
    await page.keyboard.press("Enter");
    const dialog = dialogOf(page, number);
    await expect(dialog).toBeVisible();
    // The focus is inside the dialog and stays there when tabbing around.
    for (let step = 0; step < 6; step += 1) {
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      );
      expect(inside).toBe(true);
      await page.keyboard.press("Tab");
    }
    for (const target of [
      dialog.getByRole("button", { name: "Taak behouden" }),
      dialog.getByRole("button", { name: "Taak annuleren" }),
    ]) {
      await expectTapTarget(target, isMobile ? 44 : 40);
    }
    await dialog.getByRole("button", { name: "Taak behouden" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await readTaskCancellation(number)).status).toBe("assigned");
  });

  test("the technician picked the task up meanwhile: call him first, the reason stays, nothing is cancelled", async ({
    page,
    token,
    kevin,
  }) => {
    const number = await assignedTask(token, kevin);
    await openTask(page, number);
    const dialog = await openDialog(page, number);
    await dialog.getByLabel(/Reden/).fill("Klant heeft zelf afgezegd");
    await pickUpTaskBehindTheBack(number);

    await dialog.getByRole("button", { name: "Taak annuleren" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      `${kevin.fullName} heeft deze taak intussen opgepikt. Bel hem eerst; zet de taak daarna terug als ze echt niet doorgaat.`,
    );
    expect((await readTaskCancellation(number)).status).toBe("picked_up");
    // What was typed is still there.
    await expect(dialog.getByLabel(/Reden/)).toHaveValue("Klant heeft zelf afgezegd");

    // After reloading the page offers Terugzetten, and no longer Taak annuleren.
    await dialog.getByRole("button", { name: "Pagina herladen" }).click();
    await expect(dialogOf(page, number)).toHaveCount(0);
    await expect(visible(page.getByRole("button", { name: "Terugzetten" }))).toBeVisible();
    await expect(openButton(page)).toHaveCount(0);
  });

  test("a colleague edited the task meanwhile: 'intussen gewijzigd', and after reloading it can be cancelled", async ({
    page,
    token,
    kevin,
  }) => {
    const number = await assignedTask(token, kevin);
    await openTask(page, number);
    const dialog = await openDialog(page, number);
    await changeTaskInstructions(number, "Andere instructies van een collega");

    await dialog.getByLabel(/Reden/).fill("Klant heeft zelf afgezegd");
    await dialog.getByRole("button", { name: "Taak annuleren" }).click();
    await expect(dialog.getByText(CHANGED)).toBeVisible();
    expect((await readTaskCancellation(number)).status).toBe("assigned");

    await dialog.getByRole("button", { name: "Pagina herladen" }).click();
    await expect(page.getByText("Andere instructies van een collega")).toBeVisible();
    // With the fresh version the cancellation now works.
    const again = await openDialog(page, number);
    await again.getByRole("button", { name: "Taak annuleren" }).click();
    await expect(page.getByRole("status")).toContainText(`Taak #${number} is geannuleerd.`);
    expect((await readTaskCancellation(number)).status).toBe("cancelled");
  });

  test("a colleague cancelled the task meanwhile: 'intussen gewijzigd', and the first reason stays", async ({
    page,
    token,
    kevin,
  }) => {
    const number = await assignedTask(token, kevin);
    await openTask(page, number);
    const dialog = await openDialog(page, number);
    await cancelTaskAsOffice(number, BACKOFFICE.email);

    await dialog.getByLabel(/Reden/).fill("Tweede reden");
    await dialog.getByRole("button", { name: "Taak annuleren" }).click();
    await expect(dialog.getByText(CHANGED)).toBeVisible();
    expect((await readTaskCancellation(number)).cancellationReason).toBeNull();

    await dialog.getByRole("button", { name: "Pagina herladen" }).click();
    await expect(page.getByText(/Deze taak is geannuleerd op /)).toBeVisible();
    await expect(openButton(page)).toHaveCount(0);
  });

  test("an Opgepikt task cannot be cancelled: the office first uses Terugzetten", async ({
    page,
    token,
    kevin,
  }) => {
    const customer = await customerOf(token, "Opgepikt");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "picked_up", scheduledDate: "2031-03-10", startTime: "08:00" },
    ]);
    await openTask(page, number);
    await expect(visible(page.getByRole("button", { name: "Terugzetten" }))).toBeVisible();
    await expect(page.getByRole("button", { name: "Taak annuleren" })).toHaveCount(0);
  });

  test("a finished task cannot be cancelled either", async ({ page, token, kevin }) => {
    const customer = await customerOf(token, "Afgewerkt");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "completed", scheduledDate: "2031-03-10", startTime: "08:00" },
    ]);
    await openTask(page, number);
    await expect(page.getByRole("button", { name: "Taak annuleren" })).toHaveCount(0);
  });
});
