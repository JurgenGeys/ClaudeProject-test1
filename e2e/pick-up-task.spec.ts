import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  cancelTaskAsOffice,
  changeTaskInstructions,
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  reassignTask,
  readTaskPickUp,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
  setProfileActive,
} from "./support/users";

// T2 "Taak oppikken" (BT-12) is a phone screen: this file only runs on the phone project. Every
// test makes its own technicians, customer and tasks, and removes them afterwards. The office
// acts "behind the back" of an open page through the database, like a colleague would.

type Fixtures = {
  /** Two technicians of this test only. Removed afterwards. */
  technicians: { kevin: TestUser; jens: TestUser };
  /** A text that only the customers of this test contain; customers and tasks are removed afterwards. */
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
    const kevin = await makeTechnician("pick-a", "Kevin Oppik", testInfo.project.name);
    const jens = await makeTechnician("pick-b", "Jens Oppik", testInfo.project.name);
    await run({ kevin, jens });
    for (const user of [kevin, jens]) {
      await removeTasksOf(user.email);
      await removeUser(user.email);
    }
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxpick${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "T2 is a phone screen; it is tested on the phone viewport");
});

function brusselsToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** `14:05`, in Belgian time, from the time the database holds (not from the application's formatter). */
function brusselsClock(moment: Date): string {
  return new Intl.DateTimeFormat("nl-BE", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(moment);
}

async function signInAndOpen(page: Page, user: TestUser, number: number): Promise<void> {
  await signIn(page, user);
  // `signIn` does not wait for the result: a goto before the redirect can cancel the sign-in.
  await expect(page).toHaveURL("/my-tasks");
  await page.goto(`/my-tasks/${number}`);
  await expect(page).toHaveURL(`/my-tasks/${number}`);
  await expect(page.getByRole("heading", { level: 1 }).filter({ visible: true })).toBeVisible();
}

/** The big button of T2, found among the visible elements (Next keeps the previous route hidden in the DOM). */
const pickUpButton = (page: Page) =>
  page.getByRole("button", { name: "Oppikken", exact: true }).filter({ visible: true });

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Taak oppikken?" });

/** Taps "Oppikken" until the dialog is open (a tap does nothing before the page is hydrated). */
async function openDialog(page: Page): Promise<Locator> {
  const dialog = dialogOf(page);
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await pickUpButton(page).click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

/**
 * The notice "Opgepikt om 08:12". Found by its text, as Next's own route announcer is a visible
 * `alert` too, and among the visible elements, as Next keeps the previous route hidden.
 */
const pickedUpNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Opgepikt om" }).filter({ visible: true });

/** A message of the page that is a `role="alert"`, found by its text (see above). */
const alertWith = (page: Page, text: string) =>
  page.getByRole("alert").filter({ hasText: text }).filter({ visible: true });

/** A tap target must be at least 44 px high (and wide). */
async function expectTapTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

async function customerOf(token: string, name: string): Promise<string> {
  return createCustomer(`${token} ${name}`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
}

test.describe("Oppikken (T2)", () => {
  test("asks for confirmation, then picks the task up; Annuleren and Escape change nothing", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Bakkerij");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday(), startTime: "08:00" },
    ]);
    await signInAndOpen(page, kevin, number);

    await test.step("the button is big and fixed at the bottom, with a hint", async () => {
      await expectTapTarget(pickUpButton(page));
      await expect(
        page.getByText("Tik hierop als je vertrekt naar de klant.").filter({ visible: true }),
      ).toBeVisible();
    });

    await test.step("the dialog asks the question of the design, with two big buttons and the focus on Annuleren", async () => {
      const dialog = await openDialog(page);
      await expect(dialog).toContainText(
        `Kantoor ziet dan dat je onderweg bent naar ${token} Bakkerij. Je kan dit niet zelf ongedaan maken.`,
      );
      const yes = dialog.getByRole("button", { name: "Ja, ik vertrek" });
      const no = dialog.getByRole("button", { name: "Annuleren" });
      await expectTapTarget(yes);
      await expectTapTarget(no);
      await expect(dialog.getByRole("button")).toHaveCount(2);
      await expect(no).toBeFocused();
      // The focus stays inside the dialog.
      await page.keyboard.press("Tab");
      await expect(yes).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(no).toBeFocused();
    });

    await test.step("Annuleren closes it and nothing happened", async () => {
      await dialogOf(page).getByRole("button", { name: "Annuleren" }).click();
      await expect(dialogOf(page)).toBeHidden();
      expect((await readTaskPickUp(number)).status).toBe("assigned");
    });

    await test.step("Escape closes it and gives the focus back to Oppikken", async () => {
      await openDialog(page);
      await page.keyboard.press("Escape");
      await expect(dialogOf(page)).toBeHidden();
      await expect(pickUpButton(page)).toBeFocused();
      expect((await readTaskPickUp(number)).status).toBe("assigned");
    });

    await test.step("Ja, ik vertrek picks the task up and the page shows when", async () => {
      const dialog = await openDialog(page);
      await dialog.getByRole("button", { name: "Ja, ik vertrek" }).click();
      const notice = pickedUpNotice(page);
      await expect(notice).toContainText(/^Opgepikt om \d{2}:\d{2}/);
      await expect(notice).toContainText("Kantoor ziet dat je onderweg of bezig bent.");
      await expect(dialogOf(page)).toBeHidden();
      await expect(pickUpButton(page)).toHaveCount(0);
      await expect(notice).toBeFocused();
      await expect(
        page.getByText("Opgepikt", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();

      const stored = await readTaskPickUp(number);
      expect(stored).toMatchObject({
        status: "picked_up",
        assigneeEmail: kevin.email.toLowerCase(),
        updatedByEmail: kevin.email.toLowerCase(),
      });
      expect(stored.pickedUpAt).not.toBeNull();
      await expect(notice).toContainText(`Opgepikt om ${brusselsClock(stored.pickedUpAt!)}`);
    });

    await test.step("a reload still shows it, and 'Mijn taken' lists the task under Bezig", async () => {
      await page.reload();
      await expect(pickedUpNotice(page)).toContainText(/^Opgepikt om \d{2}:\d{2}/);
      await page.getByRole("link", { name: "← Mijn taken" }).filter({ visible: true }).click();
      await expect(page).toHaveURL("/my-tasks");
      await expect(page.getByRole("region", { name: "Bezig" })).toContainText(`#${number}`);
    });
  });

  test("a second task can be picked up while the first one is picked up (K5)", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Twee taken");
    const today = brusselsToday();
    const [first, second] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: today, startTime: "08:00" },
      { status: "assigned", scheduledDate: today, startTime: "10:00" },
    ]);

    await signInAndOpen(page, kevin, first);
    await (await openDialog(page)).getByRole("button", { name: "Ja, ik vertrek" }).click();
    await expect(pickedUpNotice(page)).toContainText("Opgepikt om");

    await page.goto(`/my-tasks/${second}`);
    await expect(page).toHaveURL(`/my-tasks/${second}`);
    // No message and no block: the second task has its button like any other.
    await expect(pickUpButton(page)).toBeVisible();
    await expect(alertWith(page, "niet meer aan jou toegewezen")).toHaveCount(0);
    await (await openDialog(page)).getByRole("button", { name: "Ja, ik vertrek" }).click();
    await expect(pickedUpNotice(page)).toContainText("Opgepikt om");

    expect((await readTaskPickUp(first)).status).toBe("picked_up");
    expect((await readTaskPickUp(second)).status).toBe("picked_up");

    await page.goto("/my-tasks");
    const busy = page.getByRole("region", { name: "Bezig" });
    await expect(busy.getByRole("link")).toHaveCount(2);
    await expect(busy).toContainText(`#${first}`);
    await expect(busy).toContainText(`#${second}`);
  });

  test("a task that was given to a colleague meanwhile: the message of the design, nothing is overwritten", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const customer = await customerOf(token, "Verschoven");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday(), startTime: "08:00" },
    ]);
    await signInAndOpen(page, kevin, number);
    await openDialog(page);

    await reassignTask(number, jens.email);
    await dialogOf(page).getByRole("button", { name: "Ja, ik vertrek" }).click();

    const alert = alertWith(page, "Deze taak is niet meer aan jou toegewezen.");
    await expect(alert).toContainText("Deze taak is niet meer aan jou toegewezen.");
    await expect(dialogOf(page)).toBeHidden();
    await expect(pickUpButton(page)).toHaveCount(0);
    await expect(alert).toBeFocused();
    const back = alert.getByRole("link", { name: "Terug naar mijn taken" });
    await expectTapTarget(back);

    expect(await readTaskPickUp(number)).toMatchObject({
      status: "assigned",
      assigneeEmail: jens.email.toLowerCase(),
      pickedUpAt: null,
    });

    await back.click();
    await expect(page).toHaveURL("/my-tasks");
    await expect(page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) })).toHaveCount(0);
  });

  test("a task that was cancelled meanwhile: 'geannuleerd door kantoor' and a way back", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Geannuleerd");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday(), startTime: "08:00" },
    ]);
    await signInAndOpen(page, kevin, number);
    await openDialog(page);

    await cancelTaskAsOffice(number, BACKOFFICE.email);
    await dialogOf(page).getByRole("button", { name: "Ja, ik vertrek" }).click();

    const heading = page
      .getByRole("heading", { level: 1, name: "Deze taak is geannuleerd door kantoor." })
      .filter({ visible: true });
    await expect(heading).toBeVisible();
    await expect(
      page.getByText("Je hoeft niets meer te doen.").filter({ visible: true }),
    ).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(pickUpButton(page)).toHaveCount(0);
    const back = page
      .getByRole("link", { name: "Terug naar mijn taken" })
      .filter({ visible: true });
    await expectTapTarget(back);

    expect((await readTaskPickUp(number)).status).toBe("cancelled");
    expect((await readTaskPickUp(number)).pickedUpAt).toBeNull();

    await back.click();
    await expect(page).toHaveURL("/my-tasks");
  });

  test("a task that was edited meanwhile: 'intussen gewijzigd', and after reloading it can be picked up", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Gewijzigd");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      {
        status: "assigned",
        scheduledDate: brusselsToday(),
        startTime: "08:00",
        instructions: "Eerste versie",
      },
    ]);
    await signInAndOpen(page, kevin, number);
    await openDialog(page);

    await changeTaskInstructions(number, "Tweede versie van de instructies");
    await dialogOf(page).getByRole("button", { name: "Ja, ik vertrek" }).click();

    const alert = alertWith(page, "Deze taak is intussen gewijzigd.");
    await expect(alert).toContainText("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.");
    expect((await readTaskPickUp(number)).status).toBe("assigned");

    const reload = alert.getByRole("button", { name: "Pagina herladen" });
    await expectTapTarget(reload);
    await reload.click();
    await expect(
      page.getByText("Tweede versie van de instructies").filter({ visible: true }),
    ).toBeVisible();
    await expect(alertWith(page, "intussen gewijzigd")).toHaveCount(0);

    await (await openDialog(page)).getByRole("button", { name: "Ja, ik vertrek" }).click();
    await expect(pickedUpNotice(page)).toContainText("Opgepikt om");
    expect((await readTaskPickUp(number)).status).toBe("picked_up");
  });

  test("a technician who was switched off meanwhile cannot pick up, and nothing changes", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Uitgeschakeld");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday(), startTime: "08:00" },
    ]);
    await signInAndOpen(page, kevin, number);
    const dialog = await openDialog(page);

    await setProfileActive(kevin.email, false);
    await dialog.getByRole("button", { name: "Ja, ik vertrek" }).click();

    await expect(dialog).toContainText("Je account is uitgeschakeld. Neem contact op met kantoor.");
    expect(await readTaskPickUp(number)).toMatchObject({ status: "assigned", pickedUpAt: null });
  });

  test("a colleague's task number gives the same page as one that does not exist, without a button", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const customer = await customerOf(token, "Collega");
    const [theirs] = await createTasksWithStatus(jens.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday(), startTime: "08:00" },
    ]);
    await signInAndOpen(page, kevin, (await createOwnTask(token, kevin)).number);

    await page.goto(`/my-tasks/${theirs}`);
    await expect(
      page
        .getByRole("heading", {
          level: 1,
          name: "Deze taak bestaat niet of is niet aan jou toegewezen.",
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(pickUpButton(page)).toHaveCount(0);
    expect((await readTaskPickUp(theirs)).status).toBe("assigned");
  });
});

/** A task of this technician, so there is a page to sign in on. */
async function createOwnTask(token: string, technician: TestUser): Promise<{ number: number }> {
  const customer = await customerOf(token, "Eigen");
  const [number] = await createTasksWithStatus(technician.email, BACKOFFICE.email, customer, [
    { status: "assigned", scheduledDate: brusselsToday(), startTime: "09:00" },
  ]);
  return { number };
}
