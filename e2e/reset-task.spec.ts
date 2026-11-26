import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  changeTaskInstructions,
  completeTaskBehindTheBack,
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  readTaskCompletion,
  readTaskPickUp,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
  setProfileActive,
} from "./support/users";

// "Terugzetten" (BT-14) in B3: the office puts a picked up task back to Toegewezen, for the same
// or another technician, and the technician sees it in his list. Every test makes its own
// technicians, customer and tasks, and removes them afterwards. A colleague or the technician
// acts "behind the back" of the open page through the database.

type Fixtures = {
  technicians: { kevin: TestUser; jens: TestUser };
  token: string;
};

async function makeTechnician(prefix: string, name: string, project: string): Promise<TestUser> {
  const random = Math.random().toString(36).slice(2, 8);
  const user: TestUser = {
    email: `e2e-${prefix}-${project}-${Date.now()}-${random}@example.com`,
    fullName: `${name} ${random}`,
    role: "technician",
  };
  await ensureUser(user);
  return user;
}

const test = base.extend<Fixtures>({
  technicians: async ({}, run, testInfo) => {
    const kevin = await makeTechnician("reset-a", "Kevin Terug", testInfo.project.name);
    const jens = await makeTechnician("reset-b", "Jens Terug", testInfo.project.name);
    await run({ kevin, jens });
    for (const user of [kevin, jens]) {
      await removeTasksOf(user.email);
      await removeUser(user.email);
    }
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxreset${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

/** A picked up task of this technician, planned on 10 March 2031 at 08:00. */
async function pickedUpTask(token: string, technician: TestUser): Promise<number> {
  const customer = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
  const [number] = await createTasksWithStatus(technician.email, BACKOFFICE.email, customer, [
    {
      status: "picked_up",
      scheduledDate: "2031-03-10",
      startTime: "08:00",
      pickedUpAt: new Date("2031-03-10T06:48:00Z"),
    },
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
const openButton = (page: Page) => visible(page.getByRole("button", { name: "Terugzetten" }));
const dialog = (page: Page) => page.getByRole("dialog", { name: "Taak terugzetten" });

/**
 * The height that the stylesheet gives the element. Not `boundingBox()`: that includes the
 * zoom-in animation of the dialog and measures 39,9 px for a 40 px button.
 */
async function expectTapTarget(locator: Locator, minimum: number): Promise<void> {
  const height = await locator.evaluate((element) => parseFloat(getComputedStyle(element).height));
  expect(height).toBeGreaterThanOrEqual(minimum);
}

test.describe("Terugzetten (B3)", () => {
  test("the office puts a picked up task back for another technician and date, who then sees it", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);

    await test.step("an Opgepikt task offers Terugzetten and the dialog has the texts of the design", async () => {
      await expect(page.getByText("Opgepikt", { exact: true }).first()).toBeVisible();
      await openButton(page).click();
      await expect(dialog(page)).toContainText(
        "Gebruik dit als de taak niet kon doorgaan, bv. omdat de klant niet thuis was. De taak komt terug op Toegewezen. Je kan meteen een andere technieker of datum kiezen.",
      );
      await expect(dialog(page).getByLabel("Technieker").locator("option:checked")).toHaveText(
        kevin.fullName,
      );
      await expect(dialog(page).getByLabel("Datum")).toHaveValue("2031-03-10");
      await expect(dialog(page).getByLabel("Startuur")).toHaveValue("08:00");
    });

    await test.step("Escape closes the dialog without a change and gives the focus back", async () => {
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      await expect(openButton(page)).toBeFocused();
      expect((await readTaskPickUp(number)).status).toBe("picked_up");
    });

    await test.step("a technician, date and start time are chosen and saved", async () => {
      await openButton(page).click();
      await dialog(page).getByLabel("Technieker").selectOption({ label: jens.fullName });
      await dialog(page).getByLabel("Datum").fill("2031-03-12");
      await dialog(page).getByLabel("Startuur").fill("10:15");
      await dialog(page).getByRole("button", { name: "Terugzetten" }).click();

      await expect(page.getByRole("status")).toContainText(
        `Taak teruggezet. Ze staat opnieuw op Toegewezen bij ${jens.fullName}, voor wo 12/03/2031 om 10:15.`,
      );
      await expect(dialog(page)).toHaveCount(0);
      await expect(openButton(page)).toHaveCount(0);
      await expect(page.getByText("Toegewezen", { exact: true }).first()).toBeVisible();
      await expect(page).toHaveURL(`/tasks/${number}`);
      const saved = await readTaskPickUp(number);
      expect(saved).toMatchObject({
        status: "assigned",
        pickedUpAt: null,
        assigneeEmail: jens.email.toLowerCase(),
        updatedByEmail: BACKOFFICE.email.toLowerCase(),
      });
    });

    await test.step("the new technician sees the task, the old one does not", async () => {
      await page.getByRole("button", { name: "Uitloggen" }).click();
      await signIn(page, jens);
      await expect(page).toHaveURL("/my-tasks");
      await expect(visible(page.getByText(`#${number}`).first())).toBeVisible();
      await page.getByRole("button", { name: "Uitloggen" }).click();
      await signIn(page, kevin);
      await expect(page).toHaveURL("/my-tasks");
      await expect(page.getByText(`#${number}`)).toHaveCount(0);
    });
  });

  test("with the same technician and nothing else changed the task is Toegewezen again", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);
    await openButton(page).click();
    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(page.getByRole("status")).toContainText(
      `Taak teruggezet. Ze staat opnieuw op Toegewezen bij ${kevin.fullName}, voor ma 10/03/2031 om 08:00.`,
    );
    expect(await readTaskPickUp(number)).toMatchObject({
      status: "assigned",
      pickedUpAt: null,
      assigneeEmail: kevin.email.toLowerCase(),
    });
  });

  test("the dialog works with the keyboard and has tap targets that are big enough", async ({
    page,
    token,
    isMobile,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);
    await openButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    // The focus is inside the dialog and stays there when tabbing around.
    for (let step = 0; step < 8; step += 1) {
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      );
      expect(inside).toBe(true);
      await page.keyboard.press("Tab");
    }
    for (const target of [
      dialog(page).getByLabel("Technieker"),
      dialog(page).getByLabel("Datum"),
      dialog(page).getByRole("button", { name: "Annuleren" }),
      dialog(page).getByRole("button", { name: "Terugzetten" }),
    ]) {
      await expectTapTarget(target, isMobile ? 44 : 40);
    }
    await dialog(page).getByRole("button", { name: "Annuleren" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await readTaskPickUp(number)).status).toBe("picked_up");
  });

  test("a missing date is refused under the field and nothing is saved", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);
    await openButton(page).click();
    await dialog(page).getByLabel("Technieker").selectOption({ label: jens.fullName });
    await dialog(page).getByLabel("Startuur").fill("10:15");
    await dialog(page).getByLabel("Datum").fill("");
    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(dialog(page).getByText("Kies een datum.")).toBeVisible();
    // The other choices are still there after the refusal.
    await expect(dialog(page).getByLabel("Technieker").locator("option:checked")).toHaveText(
      jens.fullName,
    );
    await expect(dialog(page).getByLabel("Startuur")).toHaveValue("10:15");
    expect((await readTaskPickUp(number)).status).toBe("picked_up");
  });

  test("the technician finished the task meanwhile: 'intussen gewijzigd', the hours stay", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);
    await openButton(page).click();
    await completeTaskBehindTheBack(number);

    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(
      dialog(page).getByText("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw."),
    ).toBeVisible();
    const completion = await readTaskCompletion(number);
    expect(completion.status).toBe("completed");
    expect(completion.completions).toHaveLength(1);

    await dialog(page).getByRole("button", { name: "Pagina herladen" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("Afgewerkt", { exact: true }).first()).toBeVisible();
    await expect(openButton(page)).toHaveCount(0);
  });

  test("a colleague edited the task meanwhile: 'intussen gewijzigd', and nothing is reset", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);
    await openButton(page).click();
    await changeTaskInstructions(number, "Andere instructies van een collega");

    await dialog(page).getByLabel("Datum").fill("2031-03-12");
    await dialog(page).getByLabel("Startuur").fill("10:15");
    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(
      dialog(page).getByText("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw."),
    ).toBeVisible();
    expect((await readTaskPickUp(number)).status).toBe("picked_up");
    // What was chosen is still there: the form is not set back to the old planning.
    await expect(dialog(page).getByLabel("Datum")).toHaveValue("2031-03-12");
    await expect(dialog(page).getByLabel("Startuur")).toHaveValue("10:15");

    await dialog(page).getByRole("button", { name: "Pagina herladen" }).click();
    await expect(page.getByText("Andere instructies van een collega")).toBeVisible();
    // With the fresh version the reset now works.
    await openButton(page).click();
    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(page.getByRole("status")).toContainText("Taak teruggezet.");
    expect((await readTaskPickUp(number)).status).toBe("assigned");
  });

  test("the chosen technician is switched off meanwhile: the choice becomes 'Kies een technieker'", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const number = await pickedUpTask(token, kevin);
    await openTask(page, number);
    await openButton(page).click();
    await dialog(page).getByLabel("Technieker").selectOption({ label: jens.fullName });
    await setProfileActive(jens.email, false);

    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(
      dialog(page).getByText(`${jens.fullName} is niet meer actief. Kies een andere technieker.`),
    ).toBeVisible();
    // The refreshed list no longer has Jens, and the select does not silently show another one.
    const select = dialog(page).getByLabel("Technieker");
    await expect(select).toHaveValue("");
    await expect(select.locator("option:checked")).toHaveText("Kies een technieker");
    expect((await readTaskPickUp(number)).status).toBe("picked_up");

    // A second click asks for a choice; it does not give the task to somebody else.
    await dialog(page).getByRole("button", { name: "Terugzetten" }).click();
    await expect(dialog(page).getByText("Kies een technieker uit de lijst.")).toBeVisible();
    expect(await readTaskPickUp(number)).toMatchObject({
      status: "picked_up",
      assigneeEmail: kevin.email.toLowerCase(),
    });
  });

  test("a task that is not picked up has no Terugzetten", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await openTask(page, number);
    await expect(page.getByRole("link", { name: "Bewerken" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Terugzetten" })).toHaveCount(0);
  });
});
