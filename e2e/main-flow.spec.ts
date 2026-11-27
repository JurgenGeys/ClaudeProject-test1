import { readFile } from "node:fs/promises";

import {
  test as base,
  devices,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { waitForConfirmLinks } from "./support/mailbox";
import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  ensureUser,
  readProfileId,
  readTaskCompletion,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

// BT-20: the main flow from the first mail to the invoice, as the office (a desktop browser) and a
// technician (a phone) would walk it, side by side in two browser contexts. The screens have their
// own tests; this file only checks that they work together, and only looks at what the next person
// in the chain sees. Every test makes its own technician and customer, and removes them afterwards.
// The tests open their own contexts, so they run on one project only.

const PASSWORD = "Een-nieuw-wachtwoord-2026";

type Traject = {
  technician: TestUser;
  /** A text that only the customer of this test contains. */
  token: string;
};

type Fixtures = {
  traject: Traject;
  /** The office at a desktop browser, not signed in. */
  office: Page;
  /** The technician at a phone (Pixel 7), not signed in. */
  phone: Page;
};

const test = base.extend<Fixtures>({
  traject: async ({}, run, testInfo: TestInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const technician: TestUser = {
      email: `e2e-flow-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Tina Traject ${random}`,
      role: "technician",
    };
    const token = `Zqxflow${testInfo.project.name}${Date.now()}${random}`;
    await run({ technician, token });
    // Customers (and with them the tasks) first: the tasks refer to the technician.
    await removeCustomersNamed(token);
    await removeTasksOf(technician.email);
    await removeUser(technician.email);
  },
  office: async ({ browser, baseURL }, run) => {
    const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL });
    await run(await context.newPage());
    await context.close();
  },
  phone: async ({ browser, baseURL }, run) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    await run(await context.newPage());
    await context.close();
  },
});

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "The tests open a desktop and a phone context themselves: run them once");
});

/** Everything is looked up among the visible elements: Next keeps the previous route hidden in the DOM. */
const visible = (locator: Locator) => locator.filter({ visible: true });

/** The day (`2026-11-27`) in Belgian time, like the application counts days. */
function brusselsDay(moment: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

/** `2026-11-27` as `27/11/2026`. */
const shown = (day: string) => day.split("-").reverse().join("/");

const taskNumberPattern = (number: number) => new RegExp(`#${number}(?!\\d)`);

/** The link to a task in a list (table and cards are both in the page: the visible one). */
const taskLink = (page: Page, number: number) =>
  visible(page.getByRole("link", { name: taskNumberPattern(number) })).first();

async function signInAs(page: Page, user: Pick<TestUser, "email">, url: string): Promise<void> {
  await signIn(page, user);
  // `signIn` does not wait for the result: a goto before the redirect can cancel the sign-in.
  await expect(page).toHaveURL(url);
}

/** Taps a button until the dialog it opens is there (a tap does nothing before React took over). */
async function openDialogWith(button: Locator, dialog: Locator): Promise<Locator> {
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await button.click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

/** Backoffice invites a technician in B7 and returns the link from the mail the technician gets. */
async function inviteTechnician(office: Page, technician: TestUser): Promise<string> {
  await office.goto("/technicians");
  const dialog = office.getByRole("dialog", { name: "Technieker toevoegen" });
  await openDialogWith(office.getByRole("button", { name: "Technieker toevoegen" }), dialog);
  await dialog.locator('form[data-hydrated="true"]:visible').waitFor();
  await dialog.getByLabel(/^Naam/).fill(technician.fullName);
  await dialog.getByLabel(/^E-mailadres/).fill(technician.email);
  await dialog.getByRole("button", { name: "Uitnodiging versturen" }).click();
  await expect(dialog).toBeHidden();
  await expect(office.getByRole("status")).toContainText(
    `Uitnodiging verstuurd naar ${technician.email}.`,
  );
  const row = office.getByRole("row", { name: new RegExp(technician.email) });
  await expect(row.getByText("Uitgenodigd")).toBeVisible();
  return (await waitForConfirmLinks(technician.email, 1))[0];
}

/** The technician opens the link on his phone and chooses a password; he ends on Mijn taken. */
async function acceptInvitation(phone: Page, link: string, technician: TestUser): Promise<void> {
  await phone.goto(link);
  await expect(phone).toHaveURL(/\/auth\/confirm\?/);
  await phone.getByRole("button", { name: "Wachtwoord instellen" }).click();
  await expect(phone).toHaveURL(/\/set-password\?mode=invite$/);
  const firstName = technician.fullName.split(" ")[0];
  await expect(
    phone.getByRole("heading", { level: 1, name: `Welkom, ${firstName}` }),
  ).toBeVisible();
  await phone.locator('form[data-hydrated="true"]:visible').waitFor();
  await phone.getByLabel("Nieuw wachtwoord", { exact: true }).fill(PASSWORD);
  await phone.getByLabel("Herhaal wachtwoord").fill(PASSWORD);
  await phone.getByRole("button", { name: "Wachtwoord bewaren" }).click();
  await expect(phone).toHaveURL("/my-tasks");
  await expect(phone.getByRole("heading", { level: 1, name: "Mijn taken" })).toBeVisible();
}

/**
 * The office makes a task for a new customer with the form (B2), assigns it to the technician and
 * ends on its page (B3). Returns the task number from the confirmation.
 */
async function createTask(office: Page, { technician, token }: Traject): Promise<number> {
  await office.goto("/tasks/new");
  await expect(office.getByRole("heading", { level: 1, name: "Nieuwe taak" })).toBeVisible();
  await office.locator('form[data-hydrated="true"]:visible').waitFor();

  await office.getByRole("button", { name: "+ Nieuwe klant" }).click();
  // The application focuses the name field in a timer after the click. Fill in only after that
  // has happened, or the timer can move the focus while the next field is being filled in.
  const name = office.getByLabel(/^Naam/);
  await expect(name).toBeFocused();
  await name.fill(`${token} Bakkerij`);
  await office.getByLabel("Telefoon").fill("014 41 22 87");
  await office.getByLabel("Straat en nummer").fill("Nieuwstraat 7");
  await office.getByLabel("Postcode").fill("9000");
  await office.getByLabel("Gemeente").fill("Gent");
  // Check the fields before saving: a wrong value must fail here, not in a later step.
  await expect(name).toHaveValue(`${token} Bakkerij`);
  await expect(office.getByLabel("Telefoon")).toHaveValue("014 41 22 87");

  await office.getByRole("radio", { name: "Onderhoud" }).check();
  await office.getByLabel("Instructies").fill("Jaarlijks onderhoud van de koeling");
  await office.getByLabel(/^Datum/).fill(brusselsDay());
  await office.getByLabel(/^Startuur/).fill("08:00");
  await office.getByLabel(/^Technieker$/).selectOption({ label: technician.fullName });

  await office.getByRole("button", { name: "Taak bewaren" }).click();
  // The address loses `?saved=1` once the confirmation is shown, so only the path is checked.
  await expect(office).toHaveURL(/\/tasks\/\d+(\?saved=1)?$/);
  const number = Number(new URL(office.url()).pathname.split("/").at(-1));
  await expect(office.getByRole("status")).toHaveText(`Taak #${number} bewaard.`);
  return number;
}

/** The technician finds the task on Mijn taken (a fresh load) and opens it. */
async function openOnPhone(phone: Page, number: number, token: string): Promise<void> {
  await phone.goto("/my-tasks");
  const card = taskLink(phone, number);
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${token} Bakkerij`);
  await expect(card).toContainText("Onderhoud");
  await card.click();
  await expect(phone).toHaveURL(`/my-tasks/${number}`);
}

/** On T2: Oppikken, confirm in the dialog. */
async function pickUp(phone: Page): Promise<void> {
  await openDialogWith(
    visible(phone.getByRole("button", { name: "Oppikken", exact: true })),
    phone.getByRole("dialog", { name: "Taak oppikken?" }),
  );
  await phone.getByRole("button", { name: "Ja, ik vertrek" }).click();
  await expect(visible(phone.getByRole("status").filter({ hasText: "Opgepikt om" }))).toBeVisible();
}

/** On T2 of a picked up task: Afmelden, 2u00 and a note on T3, Taak afmelden. */
async function completeOnPhone(phone: Page, notes: string): Promise<void> {
  await visible(phone.getByRole("link", { name: "Afmelden", exact: true })).click();
  await expect(phone.getByRole("heading", { level: 1, name: "Taak afmelden" })).toBeVisible();
  const submit = visible(
    phone.getByRole("button", { name: /^(Taak afmelden|Bezig met afmelden)/ }),
  );
  // The button is disabled until React took the page over.
  await expect(submit).toBeEnabled();
  await visible(phone.getByRole("button", { name: "2u00", exact: true })).click();
  await expect(visible(phone.getByTestId("hours-value"))).toHaveText("2u00");
  await visible(phone.getByLabel(/Notities/)).fill(notes);
  await submit.click();
  await expect(phone).toHaveURL("/my-tasks");
  await expect(visible(phone.getByRole("status").filter({ hasText: "Taak afgemeld." }))).toHaveText(
    "Taak afgemeld. Bedankt!",
  );
}

/** Clicks Download on B4 and returns the lines of the CSV file, after the byte order mark. */
async function downloadExport(office: Page, day: string, scope: "to-invoice" | "all") {
  await office.goto(`/tasks/export?from=${day}&to=${day}`);
  await office.locator('form[data-hydrated="true"]').waitFor();
  if (scope === "all") {
    await office.getByRole("radio", { name: /Afgewerkt en gefactureerd/ }).check();
  } else {
    await expect(office.getByRole("radio", { name: /Enkel nog te factureren/ })).toBeChecked();
  }
  const [download] = await Promise.all([
    office.waitForEvent("download"),
    office.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`taken-${day}-tot-${day}.csv`);
  const buffer = await readFile((await download.path())!);
  expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return buffer.toString("utf8").slice(1).split("\r\n");
}

test.describe("the main flow", () => {
  test("invite, plan, pick up, complete, correct, export and invoice, until the technician sees it as finished", async ({
    office,
    phone,
    traject,
  }) => {
    const { technician, token } = traject;
    const notes = "Filter vervangen; toestel lekt licht";
    let number = 0;

    await test.step("the office invites the technician, who chooses a password on his phone", async () => {
      await signInAs(office, BACKOFFICE, "/tasks");
      const link = await inviteTechnician(office, technician);
      await acceptInvitation(phone, link, technician);
      await expect(phone.getByText("Je hebt geen taken.")).toBeVisible();
    });

    await test.step("the office makes a customer and a task with the kind of work, and assigns it", async () => {
      number = await createTask(office, traject);
      expect(number).toBeGreaterThanOrEqual(1001);
      await expect(office.getByText("Toegewezen", { exact: true }).first()).toBeVisible();
      await expect(office.getByRole("heading", { level: 1 })).toContainText(`${token} Bakkerij`);
    });

    await test.step("the technician sees the task under Mijn taken and picks it up", async () => {
      await openOnPhone(phone, number, token);
      await pickUp(phone);
    });

    await test.step("the office sees the task as Opgepikt in the overview", async () => {
      const id = await readProfileId(technician.email);
      await office.goto(`/tasks?status=picked_up&technician=${id}`);
      await expect(taskLink(office, number)).toBeVisible();
    });

    await test.step("the technician completes the task with hours and a note", async () => {
      await completeOnPhone(phone, notes);
      // The task is no longer on his list of things to do.
      await expect(
        visible(phone.getByRole("link", { name: taskNumberPattern(number) })),
      ).toHaveCount(0);
    });

    const completed = await readTaskCompletion(number);
    expect(completed.status).toBe("completed");
    // The day the technician completed the task is the day of the export, as the application counts it.
    const day = brusselsDay(completed.completions[0].completedAt);

    await test.step("the office finds the task under Afgewerkt, with his hours and note", async () => {
      const id = await readProfileId(technician.email);
      await office.goto(`/tasks?status=completed&technician=${id}`);
      await expect(taskLink(office, number)).toBeVisible();
      const row = visible(office.locator("tr, li").filter({ has: taskLink(office, number) }));
      await expect(row.first()).toContainText("2u00");
      await taskLink(office, number).click();
      await expect(office).toHaveURL(`/tasks/${number}`);
      const block = visible(office.getByRole("region", { name: "Afmelding" }));
      await expect(block).toContainText("2u00");
      await expect(block).toContainText(notes);
    });

    await test.step("the office corrects the hours to 1u30 with a reason", async () => {
      const dialog = office.getByRole("dialog", { name: "Uren corrigeren" });
      await openDialogWith(
        visible(office.getByRole("button", { name: "Uren corrigeren" })),
        dialog,
      );
      await dialog.getByLabel(/Nieuwe uren/).selectOption("90");
      await dialog.getByLabel(/Reden/).fill("Wachttijd voor de sleutel niet aanrekenen");
      await dialog.getByRole("button", { name: "Correctie bewaren" }).click();
      await expect(visible(office.getByRole("status"))).toContainText(
        "Uren gecorrigeerd naar 1u30.",
      );
      const block = visible(office.getByRole("region", { name: "Afmelding" }));
      await expect(block).toContainText(
        `Oorspronkelijk door ${technician.fullName} ingevuld: 2u00.`,
      );
    });

    await test.step("the export holds the task with the corrected hours and the day of completing", async () => {
      const lines = await downloadExport(office, day, "to-invoice");
      expect(lines[0]).toBe(
        "Taaknummer;Datum;Klant;Adres;Technieker;Soort werk;Omschrijving;Gewerkte uren;Notities;Status",
      );
      // Other tests may complete tasks on the same day: only the line of this task is checked.
      const mine = lines.filter((line) => line.startsWith(`${number};`));
      expect(mine).toEqual([
        `${number};${shown(day)};${token} Bakkerij;Nieuwstraat 7, 9000 Gent;${technician.fullName};Onderhoud;Jaarlijks onderhoud van de koeling;1,5;"${notes}";Afgewerkt`,
      ]);
      await expect(office.getByRole("status").filter({ hasText: "gedownload" })).toContainText(
        `taken-${day}-tot-${day}.csv`,
      );
    });

    await test.step("the office marks the task as invoiced, and its hours are locked", async () => {
      await office.goto(`/tasks/${number}`);
      await expect(office.getByText(`Taak #${number}`, { exact: true })).toBeVisible();
      const dialog = office.getByRole("dialog", { name: "Markeren als gefactureerd?" });
      await openDialogWith(
        visible(office.getByRole("button", { name: "Markeer als gefactureerd" })),
        dialog,
      );
      await dialog.getByRole("button", { name: "Markeer als gefactureerd" }).click();
      await expect(visible(office.getByRole("status"))).toContainText(
        "Taak gemarkeerd als gefactureerd.",
      );
      await expect(visible(office.getByRole("region", { name: "Afmelding" }))).toContainText(
        "gefactureerde uren · vergrendeld",
      );
      await expect(visible(office.getByRole("button", { name: "Uren corrigeren" }))).toHaveCount(0);
    });

    await test.step("the export with the invoiced tasks shows the same hours, now as Gefactureerd", async () => {
      const lines = await downloadExport(office, day, "all");
      const mine = lines.filter((line) => line.startsWith(`${number};`));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toContain(`;Onderhoud;Jaarlijks onderhoud van de koeling;1,5;`);
      expect(mine[0]).toMatch(/;Gefactureerd$/);
    });

    await test.step("the technician sees the task under Afgewerkt, with the hours he filled in", async () => {
      await phone.goto("/my-tasks");
      await phone
        .getByRole("navigation", { name: "Mijn taken" })
        .getByRole("link", { name: "Afgewerkt", exact: true })
        .click();
      await expect(phone).toHaveURL("/my-tasks?tab=done");
      const item = visible(phone.getByRole("listitem").filter({ hasText: `#${number}` }));
      await expect(item).toBeVisible();
      await expect(item).toContainText(`${token} Bakkerij`);
      await expect(item).toContainText("2u00");
      // Gefactureerd is for the office: he sees Afgewerkt.
      await expect(item).toContainText("Afgewerkt");
      await expect(phone.getByText("Gefactureerd")).toHaveCount(0);
      await item.getByRole("link").click();
      await expect(phone).toHaveURL(`/my-tasks/${number}`);
      const report = visible(phone.getByRole("region", { name: "Jouw afmelding" }));
      await expect(report).toContainText("2u00");
      await expect(report).toContainText(notes);
    });
  });

  test("a task that was cancelled by the office disappears from the technician's list", async ({
    office,
    phone,
    traject,
  }) => {
    const { technician, token } = traject;
    await ensureUser(technician);

    await signInAs(office, BACKOFFICE, "/tasks");
    const number = await createTask(office, traject);

    await test.step("the technician sees the new task", async () => {
      await signInAs(phone, technician, "/my-tasks");
      await expect(taskLink(phone, number)).toBeVisible();
    });

    await test.step("the office cancels it with a reason", async () => {
      const dialog = office.getByRole("dialog", { name: `Taak #${number} annuleren?` });
      await openDialogWith(
        visible(office.getByRole("button", { name: "Taak annuleren", exact: true })),
        dialog,
      );
      await dialog.getByLabel(/Reden/).fill("Klant heeft zelf afgezegd");
      await dialog.getByRole("button", { name: "Taak annuleren" }).click();
      await expect(office.getByRole("status")).toContainText(`Taak #${number} is geannuleerd.`);
      await expect(office.getByText("Reden: Klant heeft zelf afgezegd")).toBeVisible();
    });

    await test.step("the task is under Geannuleerd for the office, and not under Actief", async () => {
      const id = await readProfileId(technician.email);
      await office.goto(`/tasks?status=cancelled&technician=${id}`);
      await expect(taskLink(office, number)).toBeVisible();
      await office.goto(`/tasks?technician=${id}`);
      await expect(office.getByRole("heading", { level: 1, name: "Taken" })).toBeVisible();
      await expect(
        visible(office.getByRole("link", { name: taskNumberPattern(number) })),
      ).toHaveCount(0);
    });

    await test.step("the technician no longer has it, and its page says why", async () => {
      await phone.goto("/my-tasks");
      await expect(phone.getByText("Je hebt geen taken.")).toBeVisible();
      await expect(phone.getByText(`#${number}`)).toHaveCount(0);
      await expect(phone.getByText(token)).toHaveCount(0);
      await phone.goto(`/my-tasks/${number}`);
      await expect(
        phone.getByRole("heading", { level: 1, name: "Deze taak is geannuleerd door kantoor." }),
      ).toBeVisible();
      await expect(
        visible(phone.getByRole("button", { name: "Oppikken", exact: true })),
      ).toHaveCount(0);
    });
  });

  test("a picked up task that cannot go ahead is reset by the office, and the technician has it to pick up again", async ({
    office,
    phone,
    traject,
  }) => {
    const { technician, token } = traject;
    await ensureUser(technician);

    await signInAs(office, BACKOFFICE, "/tasks");
    const number = await createTask(office, traject);
    await signInAs(phone, technician, "/my-tasks");
    await openOnPhone(phone, number, token);
    await pickUp(phone);

    await test.step("the office puts the picked up task back to Toegewezen", async () => {
      await office.goto(`/tasks/${number}`);
      await expect(office.getByText("Opgepikt", { exact: true }).first()).toBeVisible();
      // An Opgepikt task cannot be cancelled: the office resets it first.
      await expect(visible(office.getByRole("button", { name: "Taak annuleren" }))).toHaveCount(0);
      const dialog = office.getByRole("dialog", { name: "Taak terugzetten" });
      await openDialogWith(visible(office.getByRole("button", { name: "Terugzetten" })), dialog);
      await dialog.getByRole("button", { name: "Terugzetten" }).click();
      await expect(office.getByRole("status")).toContainText("Taak teruggezet.");
      await expect(office.getByText("Toegewezen", { exact: true }).first()).toBeVisible();
    });

    await test.step("the technician has the task again, no longer under Bezig, with Oppikken", async () => {
      await phone.goto("/my-tasks");
      await expect(taskLink(phone, number)).toBeVisible();
      await expect(phone.getByRole("region", { name: "Bezig" })).toHaveCount(0);
      await taskLink(phone, number).click();
      await expect(phone).toHaveURL(`/my-tasks/${number}`);
      await expect(
        visible(phone.getByRole("button", { name: "Oppikken", exact: true })),
      ).toBeVisible();
    });
  });
});
