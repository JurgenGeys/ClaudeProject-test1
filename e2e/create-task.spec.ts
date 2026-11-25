import { test as base, expect, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, INACTIVE_TECHNICIAN, TECHNICIAN, type TestUser } from "./support/test-users";
import {
  countTasksOfCustomersNamed,
  createCustomer,
  ensureUser,
  readTaskByNumber,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
  setProfileActive,
} from "./support/users";

const NOT_FOR_YOU = "Deze pagina is niet voor jou bedoeld";

type Fixtures = {
  /** A technician of this test only, with a name that no other test uses. Removed afterwards. */
  technician: TestUser;
  /** A text that only the customers of this test contain; their tasks and they are removed afterwards. */
  token: string;
};

const test = base.extend<Fixtures>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-create-task-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Tess Taak ${random}`,
      role: "technician",
    };
    await ensureUser(user);
    await run(user);
    await removeTasksOf(user.email);
    await removeUser(user.email);
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxe2e${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

/** Signs in as backoffice and waits for the session: `signIn` itself does not wait for the result. */
async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

/** Opens the form and waits until React took the page over (the button does nothing before). */
async function openForm(page: Page): Promise<void> {
  await page.goto("/tasks/new");
  await expect(page.getByRole("heading", { level: 1, name: "Nieuwe taak" })).toBeVisible();
  await page.locator('form[data-hydrated="true"]:visible').waitFor();
}

/**
 * Looks the customer up by his unique text and chooses him. Typing starts a search after a short
 * pause, and the search runs on the server, so this waits for the result to appear.
 */
async function chooseCustomer(page: Page, token: string): Promise<void> {
  await page.getByLabel("Zoek een klant").fill(token);
  await page
    .getByRole("list", { name: "Gevonden klanten" })
    .getByRole("button", { name: new RegExp(token) })
    .click();
  await expect(page.getByRole("button", { name: "Andere klant kiezen" })).toBeVisible();
}

/** Fills in the rest of the task (block 3) with valid values. */
async function fillTask(page: Page, workType: "Nazicht" | "Onderhoud" | "Herstelling") {
  await page.getByRole("radio", { name: workType }).check();
  await page.getByLabel("Instructies").fill("Jaarlijks onderhoud\nFilter vervangen");
  await page.getByLabel(/^Datum/).fill("2030-03-15");
  await page.getByLabel(/^Startuur/).fill("14:15");
}

/** Saves, waits for the task page (B3) and returns the task number from the confirmation. */
async function save(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Taak bewaren" }).click();
  // The address loses `?saved=1` once the confirmation is shown, so only the path is checked.
  await expect(page).toHaveURL(/\/tasks\/\d+(\?saved=1)?$/);
  const number = Number(new URL(page.url()).pathname.split("/").at(-1));
  await expect(page.getByRole("status")).toHaveText(`Taak #${number} bewaard.`);
  await expect(page.getByText(`Taak #${number}`, { exact: true })).toBeVisible();
  return number;
}

test.describe("creating a task", () => {
  test("an existing customer and no technician: the task is Open, with the address of the customer", async ({
    page,
    token,
  }) => {
    await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    await signInAsBackoffice(page);

    await test.step("the overview has a button to the form", async () => {
      await page.getByRole("link", { name: "Nieuwe taak" }).click();
      await expect(page).toHaveURL("/tasks/new");
      await page.locator('form[data-hydrated="true"]:visible').waitFor();
    });

    await test.step("choosing the customer fills in the location, which can be changed", async () => {
      await chooseCustomer(page, token);
      await expect(page.getByLabel("Straat en nummer")).toHaveValue("Gasthuisstraat 23");
      await expect(page.getByLabel("Postcode")).toHaveValue("2300");
      await expect(page.getByLabel("Gemeente")).toHaveValue("Turnhout");
      await page.getByLabel("Straat en nummer").fill("Gasthuisstraat 25");
    });

    await fillTask(page, "Onderhoud");
    await page.getByLabel("Geschatte duur").selectOption({ label: "1u30" });

    await test.step("saving leads to the task page with the task number", async () => {
      const number = await save(page);
      expect(number).toBeGreaterThanOrEqual(1001);

      const task = await readTaskByNumber(number);
      expect(task).toMatchObject({
        status: "open",
        assigneeEmail: null,
        workType: "maintenance",
        instructions: "Jaarlijks onderhoud\nFilter vervangen",
        scheduledDate: "2030-03-15",
        startTime: "14:15:00",
        estimatedMinutes: 90,
        // The task has its own location; the customer keeps his address.
        locationStreet: "Gasthuisstraat 25",
        locationPostalCode: "2300",
        locationCity: "Turnhout",
        customerStreet: "Gasthuisstraat 23",
        createdByEmail: BACKOFFICE.email,
      });
      expect(task.updatedBy).toBe(task.createdBy);
    });
  });

  test("with a technician the task is Toegewezen, and only active technicians are offered", async ({
    page,
    token,
    technician,
  }) => {
    await createCustomer(`${token} Slagerij`, BACKOFFICE.email, {
      street: "Dorp 4",
      postalCode: "2381",
      city: "Weelde",
    });
    await signInAsBackoffice(page);
    await openForm(page);
    await chooseCustomer(page, token);
    await fillTask(page, "Herstelling");

    await test.step("a switched-off technician is not in the list; an active one is", async () => {
      const select = page.getByLabel(/^Technieker$/);
      await expect(select.getByRole("option", { name: technician.fullName })).toHaveCount(1);
      await expect(select.getByRole("option", { name: INACTIVE_TECHNICIAN.fullName })).toHaveCount(
        0,
      );
      await expect(select.getByRole("option", { name: "Nog niet toewijzen" })).toHaveCount(1);
      await select.selectOption({ label: technician.fullName });
    });

    const number = await save(page);
    expect(await readTaskByNumber(number)).toMatchObject({
      status: "assigned",
      assigneeEmail: technician.email,
      workType: "repair",
      customerName: `${token} Slagerij`,
    });
  });

  test("a new customer is saved with the task, with the location as his address", async ({
    page,
    token,
  }) => {
    await signInAsBackoffice(page);
    await openForm(page);

    await page.getByRole("button", { name: "+ Nieuwe klant" }).click();
    await expect(page.getByLabel(/^Naam/)).toBeFocused();
    await page.getByLabel(/^Naam/).fill(`${token} Nieuw`);
    await page.getByLabel("Telefoon").fill("0470 12 34 56");
    await page.getByLabel("E-mail").fill("info@nieuw.example");
    await page.getByLabel("Opmerkingen").fill("Sleutel bij de buren");

    await page.getByLabel("Straat en nummer").fill("Nieuwstraat 7");
    await page.getByLabel("Postcode").fill("9000");
    await page.getByLabel("Gemeente").fill("Gent");
    await fillTask(page, "Nazicht");

    const number = await save(page);
    expect(await readTaskByNumber(number)).toMatchObject({
      status: "open",
      workType: "inspection",
      customerName: `${token} Nieuw`,
      customerPhone: "0470 12 34 56",
      customerEmail: "info@nieuw.example",
      customerNotes: "Sleutel bij de buren",
      customerStreet: "Nieuwstraat 7",
      customerPostalCode: "9000",
      customerCity: "Gent",
      locationStreet: "Nieuwstraat 7",
    });
  });

  test("the customer can be chosen with the keyboard", async ({ page, token }) => {
    await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Dorp 4",
      postalCode: "2381",
      city: "Weelde",
    });
    await signInAsBackoffice(page);
    await openForm(page);

    await page.getByLabel("Zoek een klant").fill(token);
    const result = page
      .getByRole("list", { name: "Gevonden klanten" })
      .getByRole("button", { name: new RegExp(token) });
    await expect(result).toBeVisible();
    await page.getByLabel("Zoek een klant").press("ArrowDown");
    await expect(result).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Andere klant kiezen" })).toBeVisible();
    await expect(page.getByLabel("Gemeente")).toHaveValue("Weelde");
  });
});

test.describe("mistakes in the form", () => {
  test("an empty form gives a summary with the focus and a message under every field", async ({
    page,
    token,
  }) => {
    await signInAsBackoffice(page);
    await openForm(page);

    await page.getByRole("button", { name: "Taak bewaren" }).click();

    const summary = page.getByRole("alert").filter({ hasText: "De taak is niet bewaard" });
    await expect(summary).toHaveText("De taak is niet bewaard. Vul de 8 gemarkeerde velden in.");
    await expect(summary).toBeFocused();
    await expect(page).toHaveURL("/tasks/new");
    for (const message of [
      "Kies een klant of maak een nieuwe klant aan.",
      "Vul de straat en het huisnummer in.",
      "Vul een geldige postcode in (4 cijfers).",
      "Vul de gemeente in.",
      "Kies het soort werk: nazicht, onderhoud of herstelling.",
      "Beschrijf wat de technieker moet doen.",
      "Kies een datum.",
      "Kies een startuur.",
    ]) {
      await expect(page.getByText(message, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel("Straat en nummer")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Straat en nummer")).toHaveAccessibleDescription(
      "Vul de straat en het huisnummer in.",
    );
    await expect(page.getByRole("radiogroup", { name: "Soort werk" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await test.step("what was typed stays, and the other fields can be corrected", async () => {
      await page.getByLabel("Instructies").fill("Nazicht van de koeling");
      await page.getByLabel("Postcode").fill("23");
      await page.getByRole("button", { name: "Taak bewaren" }).click();
      await expect(summary).toHaveText("De taak is niet bewaard. Vul de 7 gemarkeerde velden in.");
      await expect(page.getByLabel("Instructies")).toHaveValue("Nazicht van de koeling");
      await expect(page.getByLabel("Postcode")).toHaveValue("23");
      await expect(page.getByLabel("Postcode")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByLabel("Instructies")).not.toHaveAttribute("aria-invalid", "true");
    });

    await test.step("a new customer needs a name, and a wrong e-mail address is refused", async () => {
      await page.getByRole("button", { name: "+ Nieuwe klant" }).click();
      await page.getByLabel("E-mail").fill("geen-mailadres");
      await page.getByRole("button", { name: "Taak bewaren" }).click();
      await expect(page.getByText("Vul de naam van de klant in.", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Dit e-mailadres is niet geldig. Controleer het of laat het leeg.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByLabel(/^Naam/)).toHaveAttribute("aria-invalid", "true");
    });

    // Nothing was saved.
    expect(await countTasksOfCustomersNamed(token)).toBe(0);
  });

  test("a date in the past is allowed, with a warning", async ({ page, token }) => {
    await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Dorp 4",
      postalCode: "2381",
      city: "Weelde",
    });
    await signInAsBackoffice(page);
    await openForm(page);
    await chooseCustomer(page, token);
    await fillTask(page, "Nazicht");

    await page.getByLabel(/^Datum/).fill("2020-01-15");
    await expect(page.getByText("Deze datum ligt in het verleden.")).toBeVisible();
    await page.getByLabel(/^Datum/).fill("2030-01-15");
    await expect(page.getByText("Deze datum ligt in het verleden.")).toBeHidden();
    await page.getByLabel(/^Datum/).fill("2020-01-15");

    const number = await save(page);
    expect(await readTaskByNumber(number)).toMatchObject({
      scheduledDate: "2020-01-15",
      status: "open",
    });
  });

  test("a technician who was switched off after the form opened is refused, and is no longer offered", async ({
    page,
    token,
    technician,
  }) => {
    await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Dorp 4",
      postalCode: "2381",
      city: "Weelde",
    });
    await signInAsBackoffice(page);
    await openForm(page);
    await chooseCustomer(page, token);
    await fillTask(page, "Nazicht");
    const select = page.getByLabel(/^Technieker$/);
    await select.selectOption({ label: technician.fullName });

    // Switched off while the form is open.
    await setProfileActive(technician.email, false);
    await page.getByRole("button", { name: "Taak bewaren" }).click();

    await expect(
      page.getByText(`${technician.fullName} is niet meer actief. Kies een andere technieker.`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(select).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL("/tasks/new");
    expect(await countTasksOfCustomersNamed(token)).toBe(0);
    // The list was refreshed: he is not offered any more, and the rest of the form is intact.
    await expect(select.getByRole("option", { name: technician.fullName })).toHaveCount(0);
    await expect(page.getByLabel("Instructies")).toHaveValue(
      "Jaarlijks onderhoud\nFilter vervangen",
    );

    await test.step("without a technician the same form can be saved", async () => {
      await select.selectOption({ label: "Nog niet toewijzen" });
      const number = await save(page);
      expect(await readTaskByNumber(number)).toMatchObject({ status: "open", assigneeEmail: null });
    });
  });
});

test.describe("who may use the form", () => {
  test("a technician is told the page is not meant for him, and sees no form", async ({ page }) => {
    await signIn(page, TECHNICIAN);
    await expect(page).toHaveURL("/my-tasks");
    await page.goto("/tasks/new");
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOR_YOU })).toBeVisible();
    await expect(page.getByRole("button", { name: "Taak bewaren" })).toHaveCount(0);
    await expect(page.getByLabel("Zoek een klant")).toHaveCount(0);
  });

  test("a visitor without a session is sent to the login page", async ({ page }) => {
    await page.goto("/tasks/new");
    await expect(page).toHaveURL("/login");
  });
});
