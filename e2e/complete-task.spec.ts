import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  reassignTask,
  readTaskCompletion,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
  resetTaskAsOffice,
  changeTaskInstructions,
} from "./support/users";

// T2 "Afmelden" and T3 "Taak afmelden" (BT-13) are phone screens: this file only runs on the
// phone project. Every test makes its own technicians, customer and tasks, and removes them
// afterwards. The office acts "behind the back" of an open page through the database.

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
    const kevin = await makeTechnician("done-a", "Kevin Afmeld", testInfo.project.name);
    const jens = await makeTechnician("done-b", "Jens Afmeld", testInfo.project.name);
    await run({ kevin, jens });
    for (const user of [kevin, jens]) {
      await removeTasksOf(user.email);
      await removeUser(user.email);
    }
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxdone${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "T3 is a phone screen; it is tested on the phone viewport");
});

function brusselsToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function customerOf(token: string, name: string): Promise<string> {
  return createCustomer(`${token} ${name}`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
}

/** An Opgepikt task of this technician, planned today. */
async function pickedUpTask(token: string, name: string, technician: TestUser): Promise<number> {
  const customer = await customerOf(token, name);
  const [number] = await createTasksWithStatus(technician.email, BACKOFFICE.email, customer, [
    {
      status: "picked_up",
      scheduledDate: brusselsToday(),
      startTime: "08:00",
      pickedUpAt: new Date(),
    },
  ]);
  return number;
}

/** Signs in, waits for the redirect (a goto before it can cancel the sign-in), opens the T3 page. */
async function signInAndOpenComplete(page: Page, user: TestUser, number: number): Promise<void> {
  await signIn(page, user);
  await expect(page).toHaveURL("/my-tasks");
  await page.goto(`/my-tasks/${number}/complete`);
  await expect(page).toHaveURL(`/my-tasks/${number}/complete`);
  await expect(page.getByRole("heading", { level: 1, name: "Taak afmelden" })).toBeVisible();
}

/** Everything is looked up among the visible elements: Next keeps the previous route hidden in the DOM. */
const visible = (locator: Locator) => locator.filter({ visible: true });
const more = (page: Page) => visible(page.getByRole("button", { name: "Kwartier meer" }));
const less = (page: Page) => visible(page.getByRole("button", { name: "Kwartier minder" }));
const submit = (page: Page) =>
  visible(page.getByRole("button", { name: /^(Taak afmelden|Bezig met afmelden)/ }));
const hoursValue = (page: Page) => visible(page.getByTestId("hours-value"));
const notes = (page: Page) => visible(page.getByLabel(/Notities/));
const problem = (page: Page, text: string) =>
  visible(page.locator("#complete-problem").filter({ hasText: text }));

async function expectTapTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

/** Taps "Taak afmelden" once the page is ready (the button is disabled until React took over). */
async function send(page: Page): Promise<void> {
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
}

test.describe("Afmelden (T2 and T3)", () => {
  test("from the card 'Bezig' to a finished task with its hours", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, "Bakkerij", kevin);
    await signIn(page, kevin);
    await expect(page).toHaveURL("/my-tasks");

    await test.step("the card says how to finish, and leads to T2 with a big Afmelden", async () => {
      const busy = page.getByRole("region", { name: "Bezig" });
      await expect(busy).toContainText("tik om af te melden");
      await busy.getByRole("link").click();
      await expect(page).toHaveURL(`/my-tasks/${number}`);
      const status = visible(page.getByRole("status")).filter({ hasText: "Opgepikt om" });
      await expect(status).toContainText("Meld af als je klaar bent.");
      await expect(visible(page.getByText("Tik hierop als het werk klaar is."))).toBeVisible();
      const button = visible(page.getByRole("link", { name: "Afmelden", exact: true }));
      await expectTapTarget(button);
      await button.click();
      await expect(page).toHaveURL(`/my-tasks/${number}/complete`);
    });

    await test.step("T3 shows number, customer and the help text; hours start on 0u00", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Taak afmelden" })).toBeVisible();
      await expect(
        visible(page.getByText(`Taak #${number} · ${token} Bakkerij · vandaag 08:00`)),
      ).toBeVisible();
      await expect(
        visible(page.getByText("Enkel de tijd bij de klant. De verplaatsing telt niet mee.")),
      ).toBeVisible();
      await expect(hoursValue(page)).toHaveText("0u00");
      await expect(less(page)).toBeDisabled();
      for (const target of [more(page), less(page)]) {
        await expectTapTarget(target);
      }
      for (const name of ["0u30", "1u00", "1u30", "2u00"]) {
        await expectTapTarget(visible(page.getByRole("button", { name, exact: true })));
      }
      await expectTapTarget(submit(page));
    });

    await test.step("Taak afmelden without hours: the summary has the focus and the field message shows", async () => {
      await send(page);
      const summary = problem(page, "Vul de gewerkte uren in om af te melden.");
      await expect(summary).toBeFocused();
      await expect(
        visible(page.getByText("Vul de gewerkte uren in. Dat moet minstens 0u15 zijn.")),
      ).toBeVisible();
      expect((await readTaskCompletion(number)).status).toBe("picked_up");
    });

    await test.step("the stepper goes per quarter; the screen reader value is spoken", async () => {
      await more(page).click();
      await expect(hoursValue(page)).toHaveText("0u15");
      await expect(visible(page.locator("output"))).toContainText("15 minuten");
      await more(page).click();
      await more(page).click();
      await more(page).click();
      await more(page).click();
      await expect(hoursValue(page)).toHaveText("1u15");
      await expect(visible(page.locator("output"))).toContainText("1 uur 15 minuten");
      await less(page).click();
      await expect(hoursValue(page)).toHaveText("1u00");
      await visible(page.getByRole("button", { name: "1u30", exact: true })).click();
      await expect(hoursValue(page)).toHaveText("1u30");
    });

    await test.step("a note that is too long gives the message under the note, and keeps the hours", async () => {
      await notes(page).fill("x".repeat(2001));
      await send(page);
      await expect(
        visible(page.getByText("Je notitie is te lang. Houd het korter dan 2000 tekens.")),
      ).toBeVisible();
      await expect(hoursValue(page)).toHaveText("1u30");
      expect((await readTaskCompletion(number)).status).toBe("picked_up");
    });

    await test.step("a valid form finishes the task: back on Mijn taken with the thanks", async () => {
      await notes(page).fill("Filter vervangen, toestel lekt licht");
      await send(page);
      await expect(page).toHaveURL("/my-tasks");
      await expect(
        visible(page.getByRole("status")).filter({ hasText: "Taak afgemeld." }),
      ).toHaveText("Taak afgemeld. Bedankt!");
      const stored = await readTaskCompletion(number);
      expect(stored.status).toBe("completed");
      expect(stored.completions).toHaveLength(1);
      expect(stored.completions[0]).toMatchObject({
        workedMinutes: 90,
        notes: "Filter vervangen, toestel lekt licht",
        completedByEmail: kevin.email.toLowerCase(),
      });
      // The task is no longer under Bezig.
      await expect(page.getByRole("region", { name: "Bezig" })).toHaveCount(0);
    });

    await test.step("the tab Afgewerkt lists it with his hours, and T2 shows his report", async () => {
      await page.getByRole("link", { name: "Afgewerkt" }).click();
      const item = visible(page.getByRole("link").filter({ hasText: `#${number}` }));
      await expect(item).toContainText("1u30");
      await item.click();
      await expect(page).toHaveURL(`/my-tasks/${number}`);
      const report = visible(page.getByRole("region", { name: "Jouw afmelding" }));
      await expect(report).toContainText("1u30");
      await expect(report).toContainText("Filter vervangen, toestel lekt licht");
      await expect(visible(page.getByRole("link", { name: "Afmelden", exact: true }))).toHaveCount(
        0,
      );
    });

    await test.step("T3 of a finished task leads to T2", async () => {
      await page.goto(`/my-tasks/${number}/complete`);
      await expect(page).toHaveURL(`/my-tasks/${number}`);
    });
  });

  test("the notice 'Taak afgemeld' does not come back after a reload", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, "Herlaad", kevin);
    await signInAndOpenComplete(page, kevin, number);
    await visible(page.getByRole("button", { name: "1u00", exact: true })).click();
    await send(page);
    await expect(page).toHaveURL("/my-tasks");
    await expect(
      visible(page.getByRole("status")).filter({ hasText: "Taak afgemeld." }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Taak afgemeld. Bedankt!")).toHaveCount(0);
  });

  test("a second device finishing the same task with the same hours leaves one report", async ({
    browser,
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, "Twee toestellen", kevin);
    await signInAndOpenComplete(page, kevin, number);
    await visible(page.getByRole("button", { name: "1u00", exact: true })).click();

    const second = await browser.newContext({ ...test.info().project.use });
    try {
      const other = await second.newPage();
      await signInAndOpenComplete(other, kevin, number);
      await visible(other.getByRole("button", { name: "1u00", exact: true })).click();
      await send(other);
      await expect(other).toHaveURL("/my-tasks");
    } finally {
      await second.close();
    }

    // The first device still shows the form; sending it is a silent success.
    await send(page);
    await expect(page).toHaveURL("/my-tasks");
    await expect(
      visible(page.getByRole("status")).filter({ hasText: "Taak afgemeld." }),
    ).toBeVisible();
    const stored = await readTaskCompletion(number);
    expect(stored.completions).toHaveLength(1);
    expect(stored.completions[0].workedMinutes).toBe(60);
  });

  test("the office put the task back meanwhile: 'intussen gewijzigd', nothing is saved", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, "Teruggezet", kevin);
    await signInAndOpenComplete(page, kevin, number);
    await visible(page.getByRole("button", { name: "1u00", exact: true })).click();

    await resetTaskAsOffice(number);
    await send(page);

    const alert = problem(page, "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.");
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    const reload = alert.getByRole("button", { name: "Pagina herladen" });
    await expectTapTarget(reload);
    expect(await readTaskCompletion(number)).toMatchObject({ status: "assigned", completions: [] });

    // Looking again: the task is Toegewezen, so T2 offers Oppikken instead.
    await reload.click();
    await expect(page).toHaveURL(`/my-tasks/${number}`);
    await expect(
      visible(page.getByRole("button", { name: "Oppikken", exact: true })),
    ).toBeVisible();
  });

  test("the office edited the task meanwhile: 'intussen gewijzigd', the hours stay, and after reloading it works", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const number = await pickedUpTask(token, "Gewijzigd", kevin);
    await signInAndOpenComplete(page, kevin, number);
    await visible(page.getByRole("button", { name: "2u00", exact: true })).click();
    await notes(page).fill("Mijn notitie");

    await changeTaskInstructions(number, "Nieuwe instructies");
    await send(page);
    const alert = problem(page, "Deze taak is intussen gewijzigd.");
    await expect(alert).toBeVisible();
    expect((await readTaskCompletion(number)).completions).toHaveLength(0);

    await alert.getByRole("button", { name: "Pagina herladen" }).click();
    await expect(problem(page, "intussen gewijzigd")).toHaveCount(0);
    await expect(hoursValue(page)).toHaveText("2u00");
    await expect(notes(page)).toHaveValue("Mijn notitie");

    await send(page);
    await expect(page).toHaveURL("/my-tasks");
    expect((await readTaskCompletion(number)).completions[0]).toMatchObject({
      workedMinutes: 120,
      notes: "Mijn notitie",
    });
  });

  test("the task was given to a colleague meanwhile: the message, a way back, nothing saved", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const number = await pickedUpTask(token, "Collega", kevin);
    await signInAndOpenComplete(page, kevin, number);
    await visible(page.getByRole("button", { name: "1u00", exact: true })).click();

    await resetTaskAsOffice(number);
    await reassignTask(number, jens.email);
    await send(page);

    const alert = problem(page, "Deze taak is niet meer aan jou toegewezen.");
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    const back = alert.getByRole("link", { name: "Terug naar mijn taken" });
    await expectTapTarget(back);
    await expect(submit(page)).toHaveCount(0);
    expect((await readTaskCompletion(number)).completions).toHaveLength(0);
    await back.click();
    await expect(page).toHaveURL("/my-tasks");
  });

  test("a colleague's task and a task that is not picked up give no form", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const theirs = await pickedUpTask(token, "Van Jens", jens);
    const customer = await customerOf(token, "Nog niet opgepikt");
    const [assigned] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday(), startTime: "09:00" },
    ]);
    await signIn(page, kevin);
    await expect(page).toHaveURL("/my-tasks");

    await page.goto(`/my-tasks/${theirs}/complete`);
    await expect(
      visible(
        page.getByRole("heading", {
          level: 1,
          name: "Deze taak bestaat niet of is niet aan jou toegewezen.",
        }),
      ),
    ).toBeVisible();
    await expect(submit(page)).toHaveCount(0);

    await page.goto(`/my-tasks/${assigned}/complete`);
    await expect(page).toHaveURL(`/my-tasks/${assigned}`);
    await expect(
      visible(page.getByRole("button", { name: "Oppikken", exact: true })),
    ).toBeVisible();
  });
});
