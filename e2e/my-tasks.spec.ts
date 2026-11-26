import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

// T1 "Mijn taken" and T2 (read only) are phone screens: this file only runs on the phone project.
// Every test makes its own technicians, customers and tasks, and removes them afterwards.

const NOT_FOUND = "Deze taak bestaat niet of is niet aan jou toegewezen.";

type Fixtures = {
  /** Two technicians of this test only, with names that no other test uses. Removed afterwards. */
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
    const kevin = await makeTechnician("mine-a", "Kevin Mijn", testInfo.project.name);
    const jens = await makeTechnician("mine-b", "Jens Mijn", testInfo.project.name);
    await run({ kevin, jens });
    for (const user of [kevin, jens]) {
      await removeTasksOf(user.email);
      await removeUser(user.email);
    }
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxe2e${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "T1 and T2 are phone screens; they are tested on the phone viewport");
});

// Dates. "Today" is the Belgian day, found with the standard library; the weekday names come
// from the calendar (`getUTCDay`), not from the formatter that the application uses, so a wrong
// weekday in the application cannot agree with a wrong weekday here.
const WEEKDAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function brusselsToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** `wo 25/11`, or `wo 25/11/2026` when the day is not in the current year. */
function shortDate(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const text = `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  return year === Number(brusselsToday().slice(0, 4)) ? text : `${text}/${year}`;
}

async function signInAs(page: Page, user: TestUser, path = "/my-tasks"): Promise<void> {
  await signIn(page, user);
  // `signIn` does not wait for the result: a goto before the redirect can cancel the sign-in.
  await expect(page).toHaveURL("/my-tasks");
  if (path !== "/my-tasks") {
    await page.goto(path);
  }
}

/**
 * A tab of "Mijn taken", found inside the tab navigation and by its exact name: a card in the
 * Afgewerkt list also has "Afgewerkt" in its name (its label), and Next keeps the previous page
 * in the DOM (hidden) after a navigation, so a loose search finds more than the tab.
 */
const tab = (page: Page, name: "Te doen" | "Afgewerkt") =>
  page.getByRole("navigation", { name: "Mijn taken" }).getByRole("link", { name, exact: true });

/** A tap target must be at least 44 px high (and wide). */
async function expectTapTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

async function customerOf(token: string, name: string, phone?: string): Promise<string> {
  return createCustomer(`${token} ${name}`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
    phone,
  });
}

test.describe("Mijn taken (T1), tab Te doen", () => {
  test("shows Bezig, Te laat and the days in order, only his own open tasks", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const today = brusselsToday();
    const tomorrow = addDays(today, 1);
    const later = addDays(today, 2);
    const past = addDays(today, -3);
    const mine = await customerOf(token, "Eigen");
    const theirs = await customerOf(token, "Collega");

    const [late, busy, todayLate, todayEarly, tomorrowTask, laterTask, farTask] =
      await createTasksWithStatus(kevin.email, BACKOFFICE.email, mine, [
        {
          status: "assigned",
          scheduledDate: past,
          startTime: "15:00",
          workType: "inspection",
          instructions: "Nazicht afstandsbediening\nTweede regel die niet in de lijst staat",
        },
        { status: "picked_up", scheduledDate: today, startTime: "08:00", workType: "maintenance" },
        { status: "assigned", scheduledDate: today, startTime: "13:30", workType: "repair" },
        { status: "assigned", scheduledDate: today, startTime: "09:00", workType: "maintenance" },
        { status: "assigned", scheduledDate: tomorrow, startTime: "09:00" },
        { status: "assigned", scheduledDate: later, startTime: "10:00" },
        // 10/03/2031 is a Monday; a day in another year keeps its year.
        { status: "assigned", scheduledDate: "2031-03-10", startTime: "11:00" },
      ]);
    // Not shown: cancelled, finished, invoiced, and everything of a colleague.
    await createTasksWithStatus(kevin.email, BACKOFFICE.email, mine, [
      { status: "cancelled", scheduledDate: today, instructions: "Geannuleerde taak" },
      { status: "completed", scheduledDate: today, workedMinutes: 60 },
      { status: "invoiced", scheduledDate: today, workedMinutes: 60 },
    ]);
    await createTasksWithStatus(jens.email, BACKOFFICE.email, theirs, [
      { status: "assigned", scheduledDate: today },
      { status: "picked_up", scheduledDate: today },
    ]);

    await signInAs(page, kevin);
    await expect(page.getByRole("heading", { level: 1, name: "Mijn taken" })).toBeVisible();

    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Bezig",
      "Te laat",
      `Vandaag · ${shortDate(today)}`,
      `Morgen · ${shortDate(tomorrow)}`,
      shortDate(later),
      "ma 10/03/2031",
    ]);

    await test.step("Bezig holds the picked up task, with its number and kind of work", async () => {
      const section = page.getByRole("region", { name: "Bezig" });
      await expect(section.getByRole("link")).toHaveCount(1);
      await expect(section).toContainText(`#${busy}`);
      await expect(section).toContainText("Onderhoud");
      await expect(section).toContainText("Opgepikt");
      await expect(section).toContainText("08:00");
    });

    await test.step("Te laat holds the late task with its day, number, kind of work and first line", async () => {
      const section = page.getByRole("region", { name: "Te laat" });
      await expect(section.getByRole("link")).toHaveCount(1);
      await expect(section).toContainText(`${shortDate(past)} 15:00 · #${late}`);
      await expect(section).toContainText(`${token} Eigen`);
      await expect(section).toContainText("Gent");
      await expect(section).toContainText("Nazicht · Nazicht afstandsbediening");
      await expect(section).not.toContainText("Tweede regel");
      await expect(section).toContainText("Toegewezen");
    });

    await test.step("today is sorted on start time, and does not repeat the picked up task", async () => {
      const section = page.getByRole("region", { name: `Vandaag · ${shortDate(today)}` });
      const links = section.getByRole("link");
      await expect(links).toHaveCount(2);
      await expect(links.nth(0)).toContainText(`09:00 · #${todayEarly}`);
      await expect(links.nth(1)).toContainText(`13:30 · #${todayLate}`);
      await expect(links.nth(1)).toContainText("Herstelling");
    });

    await test.step("the other days", async () => {
      await expect(
        page.getByRole("region", { name: `Morgen · ${shortDate(tomorrow)}` }),
      ).toContainText(`#${tomorrowTask}`);
      await expect(page.getByRole("region", { name: shortDate(later) })).toContainText(
        `#${laterTask}`,
      );
      await expect(page.getByRole("region", { name: "ma 10/03/2031" })).toContainText(
        `#${farTask}`,
      );
    });

    await test.step("exactly his own open tasks are there, and nothing of a colleague or cancelled", async () => {
      await expect(page.getByRole("main").getByRole("link", { name: /#\d+/ })).toHaveCount(7);
      await expect(page.getByText(`${token} Collega`)).toHaveCount(0);
      await expect(page.getByText("Geannuleerde taak")).toHaveCount(0);
      await expect(page.getByText("Geannuleerd", { exact: true })).toHaveCount(0);
    });

    await test.step("tap targets are at least 44 px", async () => {
      await expectTapTarget(tab(page, "Te doen"));
      await expectTapTarget(tab(page, "Afgewerkt"));
      await expectTapTarget(page.getByRole("button", { name: "Uitloggen" }));
      await expectTapTarget(page.getByRole("region", { name: "Bezig" }).getByRole("link").first());
    });
  });

  test("shows the empty state for a technician without tasks, also when colleagues have tasks", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const customer = await customerOf(token, "Collega");
    await createTasksWithStatus(jens.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday() },
    ]);
    await signInAs(page, kevin);
    await expect(page.getByText("Je hebt geen taken.")).toBeVisible();
    await expect(
      page.getByText("Nieuwe taken verschijnen hier zodra kantoor ze aan jou toewijst."),
    ).toBeVisible();
    await expect(page.getByText(`${token} Collega`)).toHaveCount(0);
  });

  test("an address that names another technician or tab shows nothing extra", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const customer = await customerOf(token, "Collega");
    await createTasksWithStatus(jens.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday() },
    ]);
    await signInAs(page, kevin);
    await page.goto("/my-tasks?technician=someone&assignee=someone&tab=cancelled");
    await expect(page.getByText("Je hebt geen taken.")).toBeVisible();
    await expect(page.getByText(`${token} Collega`)).toHaveCount(0);
  });
});

test.describe("Mijn taken (T1), tab Afgewerkt", () => {
  test("lists his finished tasks, newest first, with the hours he filled in", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const today = brusselsToday();
    const day1 = addDays(today, -5);
    const day2 = addDays(today, -9);
    const mine = await customerOf(token, "Eigen");
    const theirs = await customerOf(token, "Collega");
    const [first, second] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, mine, [
      // Finished first: shown last. A correction of the office does not change what he sees.
      {
        status: "completed",
        scheduledDate: day2,
        workType: "repair",
        workedMinutes: 150,
        correctedMinutes: 120,
      },
      { status: "invoiced", scheduledDate: day1, workType: "inspection", workedMinutes: 60 },
    ]);
    await createTasksWithStatus(kevin.email, BACKOFFICE.email, mine, [
      { status: "assigned", scheduledDate: today, instructions: "Nog te doen" },
      { status: "cancelled", scheduledDate: day1 },
    ]);
    await createTasksWithStatus(jens.email, BACKOFFICE.email, theirs, [
      { status: "completed", scheduledDate: day1, workedMinutes: 30 },
    ]);

    await signInAs(page, kevin);
    await tab(page, "Afgewerkt").click();
    await expect(page).toHaveURL("/my-tasks?tab=done");
    await expect(tab(page, "Afgewerkt")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Je afgemelde taken van de laatste 30 dagen.")).toBeVisible();

    const items = page.getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(`${token} Eigen`);
    await expect(items.nth(0)).toContainText(`${shortDate(day1)} · Gent`);
    await expect(items.nth(0)).toContainText(`#${second} · Nazicht`);
    await expect(items.nth(0)).toContainText("1u00");
    await expect(items.nth(0)).toContainText("Afgewerkt");
    await expect(items.nth(1)).toContainText(`${shortDate(day2)} · Gent`);
    await expect(items.nth(1)).toContainText(`#${first} · Herstelling`);
    // The 2u30 he filled in, not the 2u00 of the correction.
    await expect(items.nth(1)).toContainText("2u30");
    await expect(page.getByText(`${token} Collega`)).toHaveCount(0);
    await expect(page.getByText("Nog te doen")).toHaveCount(0);
    await expectTapTarget(items.nth(0).getByRole("link"));

    await test.step("the tab Te doen brings him back", async () => {
      await tab(page, "Te doen").click();
      await expect(page).toHaveURL("/my-tasks");
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        `Vandaag · ${shortDate(today)}`,
      ]);
    });
  });

  test("shows the empty state when nothing was finished", async ({
    page,
    technicians: { kevin },
  }) => {
    await signInAs(page, kevin);
    await tab(page, "Afgewerkt").click();
    await expect(page).toHaveURL("/my-tasks?tab=done");
    await expect(
      page.getByText("Je hebt de laatste 30 dagen nog geen taken afgemeld."),
    ).toBeVisible();
  });
});

test.describe("Taak (T2), read only", () => {
  test("a card opens the task at its number, with everything to do the work and no buttons yet", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const today = brusselsToday();
    const customer = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      {
        status: "assigned",
        scheduledDate: today,
        startTime: "08:00",
        workType: "maintenance",
        instructions: "Jaarlijks onderhoud 2 split-units\nFilters reinigen",
      },
    ]);

    await signInAs(page, kevin);
    await page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) }).click();

    await expect(page).toHaveURL(`/my-tasks/${number}`);
    await expect(page.getByRole("heading", { level: 1, name: `${token} Bakkerij` })).toBeVisible();
    await expect(
      page.getByText(`Taak #${number}`, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Toegewezen", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Onderhoud", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText(`Vandaag, ${shortDate(today)} om 08:00`)).toBeVisible();
    await expect(page.getByRole("region", { name: "Locatie" })).toContainText("Teststraat 1");
    const phone = page.getByRole("region", { name: "Klant" }).getByRole("link");
    await expect(phone).toHaveAttribute("href", "tel:014412287");
    await expectTapTarget(phone);
    const instructions = page.getByRole("region", { name: "Instructies" });
    await expect(instructions).toContainText("Jaarlijks onderhoud 2 split-units");
    await expect(instructions).toContainText("Filters reinigen");

    // BT-12 (Oppikken) and BT-13 (Afmelden) are not built yet.
    await expect(page.getByRole("button", { name: /Oppikken|Afmelden/ })).toHaveCount(0);

    await test.step("the way back", async () => {
      const back = page.getByRole("link", { name: "← Mijn taken" });
      await expectTapTarget(back);
      await back.click();
      await expect(page).toHaveURL("/my-tasks");
      await expect(page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) })).toBeVisible();
    });
  });

  test("a picked up task shows when it was picked up", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Opgepikt");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      {
        status: "picked_up",
        scheduledDate: brusselsToday(),
        // 06:48 UTC on a winter day is 07:48 in Belgium (UTC+1).
        pickedUpAt: new Date("2026-01-15T06:48:00Z"),
      },
    ]);
    await signInAs(page, kevin, `/my-tasks/${number}`);
    await expect(page.getByRole("status")).toContainText("Opgepikt om 07:48");
    await expect(page.getByRole("button", { name: /Oppikken|Afmelden/ })).toHaveCount(0);
  });

  test("a finished task shows his own report, and Gefactureerd is shown as Afgewerkt", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Klaar");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      {
        status: "invoiced",
        scheduledDate: addDays(brusselsToday(), -2),
        workedMinutes: 90,
        correctedMinutes: 60,
        notes: "Buitenunit gereinigd",
      },
    ]);
    await signInAs(page, kevin, `/my-tasks/${number}`);
    await expect(page.getByRole("heading", { level: 1, name: `${token} Klaar` })).toBeVisible();
    await expect(
      page.getByText("Afgewerkt", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Gefactureerd")).toHaveCount(0);
    const report = page.getByRole("region", { name: "Jouw afmelding" });
    await expect(report).toContainText("1u30");
    await expect(report).toContainText("Buitenunit gereinigd");
    await expect(page.getByRole("link", { name: "← Afgewerkt" })).toHaveAttribute(
      "href",
      "/my-tasks?tab=done",
    );
  });

  test("a task that was cancelled meanwhile says so and shows nothing else", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Geannuleerd");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "cancelled", scheduledDate: brusselsToday() },
    ]);
    await signInAs(page, kevin, `/my-tasks/${number}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Deze taak is geannuleerd door kantoor." }),
    ).toBeVisible();
    await expect(page.getByText("Je hoeft niets meer te doen.")).toBeVisible();
    await expect(page.getByText(`${token} Geannuleerd`)).toHaveCount(0);
    await page.getByRole("link", { name: "Terug naar mijn taken" }).click();
    await expect(page).toHaveURL("/my-tasks");
  });

  test("a task of a colleague, a task that is not assigned and a number that does not exist give the same page", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const customer = await customerOf(token, "Collega");
    const [theirs, theirsPickedUp] = await createTasksWithStatus(
      jens.email,
      BACKOFFICE.email,
      customer,
      [
        { status: "assigned", scheduledDate: brusselsToday() },
        { status: "picked_up", scheduledDate: brusselsToday() },
      ],
    );
    await signInAs(page, kevin);
    for (const path of [theirs, theirsPickedUp, 999999999, "abc", "0", "-5", "1e3", "01001"]) {
      await page.goto(`/my-tasks/${path}`);
      await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
      await expect(page.getByText(token)).toHaveCount(0);
    }
    await expectTapTarget(page.getByRole("link", { name: "Naar mijn taken" }));
    await page.getByRole("link", { name: "Naar mijn taken" }).click();
    await expect(page).toHaveURL("/my-tasks");
  });

  test("a back office user is told the page is not meant for him, without any task data", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const customer = await customerOf(token, "Geheim");
    const [number] = await createTasksWithStatus(kevin.email, BACKOFFICE.email, customer, [
      { status: "assigned", scheduledDate: brusselsToday() },
    ]);
    await signIn(page, BACKOFFICE);
    await expect(page).toHaveURL("/tasks");
    for (const path of [`/my-tasks/${number}`, "/my-tasks/999999999", "/my-tasks"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "Deze pagina is niet voor jou bedoeld" }),
      ).toBeVisible();
      await expect(page.getByText(token)).toHaveCount(0);
      await expect(page.getByText(`Taak #${number}`)).toHaveCount(0);
      await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
    }
  });

  test("a visitor without a session is sent to the login page", async ({ page }) => {
    await page.goto("/my-tasks/1001");
    await expect(page).toHaveURL("/login");
  });
});
