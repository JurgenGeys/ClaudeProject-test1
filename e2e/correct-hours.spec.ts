import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  correctHoursAsOffice,
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  invoiceTaskAsOffice,
  readProfileId,
  readTaskHours,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

// "Uren corrigeren" (BT-15) in B3: the office corrects the hours of an Afgewerkt task with a
// reason, the original hours stay visible, a Gefactureerd task is locked, and "Markeer als
// gefactureerd" notices a correction that was made after its list was opened. Every test makes
// its own technician, customer and tasks, and removes them afterwards. A colleague acts "behind
// the back" of the open page through the database.

type Fixtures = {
  technician: TestUser & { id: string };
  token: string;
};

const test = base.extend<Fixtures>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-correct-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Karel Correct ${random}`,
      role: "technician",
    };
    await ensureUser(user);
    await run({ ...user, id: await readProfileId(user.email) });
    await removeTasksOf(user.email);
    await removeUser(user.email);
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxcor${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

/** An Afgewerkt (or Gefactureerd) task with 2u00 filled in by the technician, planned on 10 March 2031. */
async function seedTask(
  technician: TestUser,
  token: string,
  status: "completed" | "invoiced" = "completed",
): Promise<number> {
  const customer = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
  const [number] = await createTasksWithStatus(technician.email, BACKOFFICE.email, customer, [
    { status, scheduledDate: "2031-03-10", workedMinutes: 120, notes: "4 units gereinigd." },
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
const openButton = (page: Page) => visible(page.getByRole("button", { name: "Uren corrigeren" }));
const dialog = (page: Page) => page.getByRole("dialog", { name: "Uren corrigeren" });
const completionBlock = (page: Page) => visible(page.getByRole("region", { name: "Afmelding" }));

/** The height that the stylesheet gives the element (not `boundingBox()`: the dialog animates). */
async function expectTapTarget(locator: Locator, minimum: number): Promise<void> {
  const height = await locator.evaluate((element) => parseFloat(getComputedStyle(element).height));
  expect(height).toBeGreaterThanOrEqual(minimum);
}

test.describe("Uren corrigeren (B3)", () => {
  test("the office corrects the hours with a reason, and the original hours stay visible", async ({
    page,
    technician,
    token,
    isMobile,
  }) => {
    const number = await seedTask(technician, token);
    await openTask(page, number);

    await test.step("the dialog shows the original hours and the hours that count as the start", async () => {
      await expect(completionBlock(page)).toContainText("2u00");
      await openButton(page).click();
      await expect(dialog(page)).toContainText(
        `Ingevuld door ${technician.fullName}: 2u00. De oorspronkelijke uren blijven zichtbaar.`,
      );
      await expect(dialog(page).getByLabel(/Nieuwe uren/)).toHaveValue("120");
      await expect(
        dialog(page)
          .getByLabel(/Nieuwe uren/)
          .locator("option"),
      ).toHaveCount(64);
      for (const target of [
        dialog(page).getByLabel(/Nieuwe uren/),
        dialog(page).getByRole("button", { name: "Annuleren" }),
        dialog(page).getByRole("button", { name: "Correctie bewaren" }),
      ]) {
        await expectTapTarget(target, isMobile ? 44 : 40);
      }
    });

    await test.step("without a reason nothing is saved, and what was chosen stays", async () => {
      await dialog(page)
        .getByLabel(/Nieuwe uren/)
        .selectOption("90");
      await dialog(page).getByRole("button", { name: "Correctie bewaren" }).click();
      await expect(
        dialog(page).getByText("Geef een reden voor de correctie, bv. 'pauze niet afgetrokken'."),
      ).toBeVisible();
      await expect(dialog(page).getByLabel(/Reden/)).toBeFocused();
      await expect(dialog(page).getByLabel(/Nieuwe uren/)).toHaveValue("90");
      expect((await readTaskHours(number)).correctedMinutes).toBeNull();
    });

    await test.step("with a reason the correction is saved and shown", async () => {
      await dialog(page).getByLabel(/Reden/).fill("Wachttijd voor de sleutel niet aanrekenen");
      await dialog(page).getByRole("button", { name: "Correctie bewaren" }).click();

      await expect(visible(page.getByRole("status"))).toContainText("Uren gecorrigeerd naar 1u30.");
      await expect(dialog(page)).toHaveCount(0);
      await expect(page).toHaveURL(`/tasks/${number}`);
      const block = completionBlock(page);
      await expect(block).toContainText("1u30");
      await expect(block).toContainText("Gecorrigeerd door");
      await expect(block).toContainText(
        `Oorspronkelijk door ${technician.fullName} ingevuld: 2u00.`,
      );
      await expect(block).toContainText("Reden: Wachttijd voor de sleutel niet aanrekenen");
      await expect(
        visible(page.getByText("Uren gecorrigeerd naar 1u30", { exact: false })),
      ).toHaveCount(
        2, // the confirmation and the timeline
      );
      expect(await readTaskHours(number)).toMatchObject({
        status: "completed",
        workedMinutes: 120,
        correctedMinutes: 90,
        correctionReason: "Wachttijd voor de sleutel niet aanrekenen",
        correctedByEmail: BACKOFFICE.email.toLowerCase(),
      });
    });

    await test.step("the overview shows the hours that count, with the label 'gecorrigeerd'", async () => {
      await page.goto(`/tasks?status=completed&technician=${technician.id}`);
      const link = visible(page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) }));
      await expect(link).toBeVisible();
      const row = visible(page.locator("tr, li").filter({ has: link }));
      await expect(row.first()).toContainText("1u30");
      await expect(row.first()).toContainText("gecorrigeerd");
    });

    await test.step("a second correction starts from the corrected hours and replaces them", async () => {
      await page.goto(`/tasks/${number}`);
      await openButton(page).click();
      await expect(dialog(page).getByLabel(/Nieuwe uren/)).toHaveValue("90");
      // The technician's hours stay in the text, whatever was corrected before.
      await expect(dialog(page)).toContainText(`Ingevuld door ${technician.fullName}: 2u00.`);
      await dialog(page)
        .getByLabel(/Nieuwe uren/)
        .selectOption("60");
      await dialog(page).getByLabel(/Reden/).fill("Tweede nazicht");
      await dialog(page).getByRole("button", { name: "Correctie bewaren" }).click();
      await expect(visible(page.getByRole("status"))).toContainText("Uren gecorrigeerd naar 1u00.");
      expect(await readTaskHours(number)).toMatchObject({
        workedMinutes: 120,
        correctedMinutes: 60,
        correctionReason: "Tweede nazicht",
      });
    });
  });

  test("Escape and Annuleren close the dialog without a change", async ({
    page,
    technician,
    token,
  }) => {
    const number = await seedTask(technician, token);
    await openTask(page, number);
    await openButton(page).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(openButton(page)).toBeFocused();

    await openButton(page).click();
    await dialog(page).getByLabel(/Reden/).fill("Niet bewaren");
    await dialog(page).getByRole("button", { name: "Annuleren" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await readTaskHours(number)).correctedMinutes).toBeNull();
  });

  test("a task that a colleague invoiced meanwhile is refused with the message of the design, and the hours stay", async ({
    page,
    technician,
    token,
  }) => {
    const number = await seedTask(technician, token);
    await openTask(page, number);
    await openButton(page).click();
    await dialog(page).getByLabel(/Reden/).fill("Te laat");
    await invoiceTaskAsOffice(number, BACKOFFICE.email);

    await dialog(page).getByRole("button", { name: "Correctie bewaren" }).click();
    await expect(
      dialog(page).getByText(
        "Deze taak is al gefactureerd. Maak eerst de markering ongedaan als je de uren wilt wijzigen.",
      ),
    ).toBeVisible();
    expect((await readTaskHours(number)).correctedMinutes).toBeNull();

    await dialog(page).getByRole("button", { name: "Pagina herladen" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(openButton(page)).toHaveCount(0);
    await expect(
      visible(page.getByRole("button", { name: "Markering ongedaan maken" })),
    ).toBeVisible();
  });

  test("a colleague corrected the hours meanwhile: 'intussen gewijzigd', and after reloading the correction works", async ({
    page,
    technician,
    token,
  }) => {
    const number = await seedTask(technician, token);
    await openTask(page, number);
    await openButton(page).click();
    await dialog(page)
      .getByLabel(/Nieuwe uren/)
      .selectOption("45");
    await dialog(page).getByLabel(/Reden/).fill("Mijn reden");
    await correctHoursAsOffice(number, BACKOFFICE.email, 105);

    await dialog(page).getByRole("button", { name: "Correctie bewaren" }).click();
    await expect(
      dialog(page).getByText("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw."),
    ).toBeVisible();
    expect((await readTaskHours(number)).correctedMinutes).toBe(105);
    // What was typed is still there.
    await expect(dialog(page).getByLabel(/Reden/)).toHaveValue("Mijn reden");

    await dialog(page).getByRole("button", { name: "Pagina herladen" }).click();
    await expect(completionBlock(page)).toContainText("1u45");
    await openButton(page).click();
    await dialog(page)
      .getByLabel(/Nieuwe uren/)
      .selectOption("45");
    await dialog(page).getByLabel(/Reden/).fill("Mijn reden");
    await dialog(page).getByRole("button", { name: "Correctie bewaren" }).click();
    await expect(visible(page.getByRole("status"))).toContainText("Uren gecorrigeerd naar 0u45.");
    expect((await readTaskHours(number)).correctedMinutes).toBe(45);
  });

  test("a Gefactureerd task has no 'Uren corrigeren', and the hours are shown as locked", async ({
    page,
    technician,
    token,
  }) => {
    const number = await seedTask(technician, token, "invoiced");
    await openTask(page, number);
    await expect(openButton(page)).toHaveCount(0);
    await expect(completionBlock(page)).toContainText("gefactureerde uren · vergrendeld");
  });

  test("a correction after the invoicing list was opened: marking does not invoice the old hours", async ({
    page,
    technician,
    token,
  }) => {
    const number = await seedTask(technician, token);
    await signIn(page, BACKOFFICE);
    await expect(page).toHaveURL("/tasks");
    await page.goto(`/tasks?status=completed&technician=${technician.id}`);
    const box = visible(
      page.getByRole("checkbox", { name: new RegExp(`^Selecteer taak #${number},`) }),
    );
    await box.click();

    await correctHoursAsOffice(number, BACKOFFICE.email, 60);

    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    await expect(
      visible(page.getByRole("status")).filter({ hasText: "intussen gewijzigd" }),
    ).toContainText("1 taak is intussen gewijzigd en is niet gemarkeerd.");
    expect(await readTaskHours(number)).toMatchObject({
      status: "completed",
      correctedMinutes: 60,
    });
  });

  test("a task that is not Afgewerkt has no 'Uren corrigeren'", async ({
    page,
    technician,
    token,
  }) => {
    const customer = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    const [number] = await createTasksWithStatus(technician.email, BACKOFFICE.email, customer, [
      { status: "picked_up", scheduledDate: "2031-03-10" },
    ]);
    await openTask(page, number);
    await expect(page.getByRole("link", { name: "Bewerken" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uren corrigeren" })).toHaveCount(0);
  });
});
