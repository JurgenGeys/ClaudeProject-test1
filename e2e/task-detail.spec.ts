import { test as base, expect, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, TECHNICIAN, type TestUser } from "./support/test-users";
import {
  changeTaskInstructions,
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  readProfileId,
  readTaskByNumber,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
  setProfileActive,
} from "./support/users";

const NOT_FOR_YOU = "Deze pagina is niet voor jou bedoeld";
const NOT_FOUND = "Deze taak bestaat niet (meer).";

type Fixtures = {
  /** Two technicians of this test only, with names that no other test uses. Removed afterwards. */
  technicians: { kevin: TestUser; jens: TestUser };
  /** A text that only the customer of this test contains; customer and tasks are removed afterwards. */
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
    const kevin = await makeTechnician("detail-a", "Kevin Detail", testInfo.project.name);
    const jens = await makeTechnician("detail-b", "Jens Detail", testInfo.project.name);
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

async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

/** Opens the edit page and waits until React took the form over (the button does nothing before). */
async function openEdit(page: Page, number: number): Promise<void> {
  await page.goto(`/tasks/${number}/edit`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Taak #${number} bewerken` }),
  ).toBeVisible();
  await page.locator('form[data-hydrated="true"]:visible').waitFor();
}

/** One customer and one task per wanted status, for one technician. */
async function seed(
  token: string,
  technician: TestUser,
  specs: Parameters<typeof createTasksWithStatus>[3],
) {
  const customerId = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
    phone: "014 41 22 87",
  });
  return createTasksWithStatus(technician.email, BACKOFFICE.email, customerId, specs);
}

test.describe("the task page (B3)", () => {
  test("a task from the overview opens at its number, with info, timeline and the way to edit", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      {
        status: "assigned",
        scheduledDate: "2031-03-10",
        startTime: "09:00",
        workType: "repair",
        instructions: "Lek aan de binnenunit\nSleutel bij de buren",
      },
    ]);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?status=assigned&technician=${await technicianId(kevin)}`);
    await page
      .getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) })
      .first()
      .click();

    await expect(page).toHaveURL(`/tasks/${number}`);
    await expect(page.getByRole("heading", { level: 1, name: `${token} Bakkerij` })).toBeVisible();
    await expect(page.getByText(`Taak #${number}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Toegewezen", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1 }).locator("xpath=following-sibling::p"),
    ).toContainText("Herstelling");
    await expect(page.getByText("di 10/03/2031 om 09:00")).toBeVisible();

    const instructions = page.getByRole("region", { name: "Instructies" });
    await expect(instructions).toContainText("Lek aan de binnenunit");
    await expect(instructions).toContainText("Sleutel bij de buren");
    await expect(page.getByRole("region", { name: "Locatie" })).toContainText("Teststraat 1");
    await expect(page.getByRole("region", { name: "Klant" })).toContainText("014 41 22 87");

    const timeline = page.getByRole("region", { name: "Tijdlijn" });
    await expect(timeline).toContainText(`door ${BACKOFFICE.fullName}`);
    await expect(timeline).toContainText(`Toegewezen aan ${kevin.fullName}`);
    await expect(timeline).toContainText("Nog niet opgepikt");

    await page.getByRole("link", { name: "Bewerken" }).click();
    await expect(page).toHaveURL(`/tasks/${number}/edit`);
  });

  test("an afgewerkt task shows the completion with the correction, and has no Bewerken", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      {
        status: "completed",
        scheduledDate: "2031-03-05",
        workedMinutes: 120,
        correctedMinutes: 90,
        notes: "Filter vervangen",
      },
    ]);
    await signInAsBackoffice(page);
    await page.goto(`/tasks/${number}`);

    const completion = page.getByRole("region", { name: "Afmelding" });
    await expect(completion).toContainText("1u30");
    await expect(completion).toContainText(`Oorspronkelijk door ${kevin.fullName} ingevuld: 2u00.`);
    await expect(completion).toContainText("Reden: E2E-correctie");
    await expect(completion).toContainText("Filter vervangen");
    await expect(page.getByRole("region", { name: "Tijdlijn" })).toContainText(
      "Uren gecorrigeerd naar 1u30",
    );
    await expect(page.getByRole("link", { name: "Bewerken" })).toHaveCount(0);
  });

  test("a cancelled task shows who, when and why, and has no actions", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      {
        status: "cancelled",
        scheduledDate: "2031-03-20",
        cancellationReason: "Klant heeft zelf afgezegd",
      },
    ]);
    await signInAsBackoffice(page);
    await page.goto(`/tasks/${number}`);

    await expect(page.getByText(/^Deze taak is geannuleerd op .* door /)).toContainText(
      BACKOFFICE.fullName,
    );
    await expect(page.getByText("Reden: Klant heeft zelf afgezegd")).toBeVisible();
    await expect(page.getByRole("link", { name: "Bewerken" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Maak een nieuwe taak aan" })).toBeVisible();
    // The rest stays readable.
    await expect(page.getByRole("region", { name: "Instructies" })).toBeVisible();

    await test.step("the edit address says it can no longer be edited, and shows no form", async () => {
      await page.goto(`/tasks/${number}/edit`);
      await expect(
        page.getByText("Deze taak is geannuleerd en kan niet meer bewerkt worden."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Wijzigingen bewaren" })).toHaveCount(0);
    });
  });

  test("a number that is not valid or does not exist gives the same 'not found' page", async ({
    page,
  }) => {
    await signInAsBackoffice(page);
    for (const path of ["999999999", "abc", "0", "-5", "1e3", "01001", "99999999999"]) {
      await page.goto(`/tasks/${path}`);
      await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
      await page.goto(`/tasks/${path}/edit`);
      await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Naar de taken" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  test("a technician is told the page is not meant for him, for a task that exists and one that does not", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await signIn(page, TECHNICIAN);
    await expect(page).toHaveURL("/my-tasks");
    for (const path of [`/tasks/${number}`, `/tasks/${number}/edit`, "/tasks/999999999"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: NOT_FOR_YOU })).toBeVisible();
      await expect(page.getByText(token)).toHaveCount(0);
      await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
    }
  });

  test("a visitor without a session is sent to the login page", async ({ page }) => {
    await page.goto("/tasks/1001");
    await expect(page).toHaveURL("/login");
  });
});

/** The id of the profile, for the overview filter and the technician select. */
const technicianId = (user: TestUser) => readProfileId(user.email);

test.describe("editing a task (B2, edit mode)", () => {
  test("a Toegewezen task goes to another technician, and keeps its number", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10", startTime: "09:00" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);

    await test.step("the form starts from the saved task", async () => {
      await expect(page.getByLabel("Straat en nummer")).toHaveValue("Teststraat 1");
      await expect(page.getByLabel(/^Datum/)).toHaveValue("2031-03-10");
      await expect(page.getByLabel(/^Startuur/)).toHaveValue("09:00");
      await expect(page.getByRole("radio", { name: "Nazicht" })).toBeChecked();
      await expect(page.getByLabel(/^Technieker$/)).toHaveValue(await technicianId(kevin));
      await expect(page.getByText(`${token} Bakkerij`)).toBeVisible();
    });

    await page.getByLabel("Instructies").fill("Nieuwe instructies");
    await page.getByLabel(/^Datum/).fill("2031-03-12");
    await page.getByRole("radio", { name: "Onderhoud" }).check();
    await page.getByLabel(/^Technieker$/).selectOption({ label: jens.fullName });
    await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();

    await expect(page).toHaveURL(`/tasks/${number}`);
    await expect(page.getByRole("status")).toHaveText(`Taak #${number} bewaard.`);
    await expect(page.getByRole("region", { name: "Technieker" })).toContainText(jens.fullName);
    await expect(page.getByRole("region", { name: "Instructies" })).toContainText(
      "Nieuwe instructies",
    );
    expect(await readTaskByNumber(number)).toMatchObject({
      number,
      status: "assigned",
      assigneeEmail: jens.email,
      workType: "maintenance",
      instructions: "Nieuwe instructies",
      scheduledDate: "2031-03-12",
    });
  });

  test("'Nog niet toewijzen' puts the task back to Open, and it is no longer in the list of the technician", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);
    await expect(page.getByLabel(/^Technieker$/)).toHaveAccessibleDescription(
      /terug op Open en ziet geen enkele technieker ze/,
    );
    await page.getByLabel(/^Technieker$/).selectOption({ label: "Nog niet toewijzen" });
    await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();

    await expect(page).toHaveURL(`/tasks/${number}`);
    await expect(page.getByRole("region", { name: "Technieker" })).toContainText(
      "Nog niet toegewezen",
    );
    await expect(page.getByRole("link", { name: "Technieker kiezen" })).toBeVisible();
    expect(await readTaskByNumber(number)).toMatchObject({ status: "open", assigneeEmail: null });
  });

  test("an Opgepikt task can be edited, but its technician cannot be changed", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "picked_up", scheduledDate: "2031-03-10" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);

    const select = page.getByLabel(/^Technieker$/);
    await expect(select).toBeDisabled();
    await expect(select).toHaveAccessibleDescription(
      "Deze taak is opgepikt. Gebruik 'Terugzetten' om een andere technieker te kiezen.",
    );
    await page.getByLabel("Instructies").fill("Aangepast tijdens het werk");
    await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();

    await expect(page).toHaveURL(`/tasks/${number}`);
    expect(await readTaskByNumber(number)).toMatchObject({
      status: "picked_up",
      assigneeEmail: kevin.email,
      instructions: "Aangepast tijdens het werk",
    });
  });

  test("mistakes give a summary with the focus and a message under the field; what was typed stays", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);

    await page.getByLabel("Straat en nummer").fill("");
    await page.getByLabel("Instructies").fill("Nog te bewaren tekst");
    await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();

    const summary = page.getByRole("alert").filter({ hasText: "De taak is niet bewaard" });
    await expect(summary).toHaveText("De taak is niet bewaard. Vul het gemarkeerde veld in.");
    await expect(summary).toBeFocused();
    await expect(page.getByLabel("Straat en nummer")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Straat en nummer")).toHaveAccessibleDescription(
      "Vul de straat en het huisnummer in.",
    );
    await expect(page.getByLabel("Instructies")).toHaveValue("Nog te bewaren tekst");
    await expect(page).toHaveURL(`/tasks/${number}/edit`);
    expect((await readTaskByNumber(number)).locationStreet).toBe("Teststraat 1");
  });

  test("when a colleague changed the task meanwhile, nothing is overwritten and the page can be reloaded", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10", instructions: "Oorspronkelijk" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);

    // A colleague saves the task while this form is open.
    await changeTaskInstructions(number, "Van een collega");

    await page.getByLabel("Instructies").fill("Mijn wijziging");
    await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();

    const alert = page.getByRole("alert").filter({ hasText: "intussen gewijzigd" });
    await expect(alert).toHaveText(/Deze taak is intussen gewijzigd\. Bekijk de taak opnieuw\./);
    await expect(alert).toBeFocused();
    await expect(page).toHaveURL(`/tasks/${number}/edit`);
    expect((await readTaskByNumber(number)).instructions).toBe("Van een collega");

    await test.step("the button reloads the page with the colleague's version", async () => {
      await alert.getByRole("button", { name: "Pagina herladen" }).click();
      await page.locator('form[data-hydrated="true"]:visible').waitFor();
      await expect(page.getByLabel("Instructies")).toHaveValue("Van een collega");
      await expect(page.getByRole("alert").filter({ hasText: "intussen gewijzigd" })).toHaveCount(
        0,
      );
    });

    await test.step("and the reloaded form can be saved", async () => {
      await page.getByLabel("Instructies").fill("Mijn wijziging, opnieuw");
      await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();
      await expect(page).toHaveURL(`/tasks/${number}`);
      expect((await readTaskByNumber(number)).instructions).toBe("Mijn wijziging, opnieuw");
    });
  });

  test("a technician who was switched off after the form opened is refused, and is no longer offered", async ({
    page,
    token,
    technicians: { kevin, jens },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);
    const select = page.getByLabel(/^Technieker$/);
    await select.selectOption({ label: jens.fullName });

    await setProfileActive(jens.email, false);
    await page.getByRole("button", { name: "Wijzigingen bewaren" }).click();

    await expect(
      page.getByText(`${jens.fullName} is niet meer actief. Kies een andere technieker.`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(select).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(`/tasks/${number}/edit`);
    expect((await readTaskByNumber(number)).assigneeEmail).toBe(kevin.email);
    // The list was refreshed: he is not offered any more.
    await expect(select.getByRole("option", { name: jens.fullName })).toHaveCount(0);
  });

  test("'Annuleren' leaves the form without saving, back to the task", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await signInAsBackoffice(page);
    await openEdit(page, number);
    await page.getByLabel("Instructies").fill("Niet bewaren");
    await page.getByRole("link", { name: "Annuleren" }).click();
    await expect(page).toHaveURL(`/tasks/${number}`);
    expect((await readTaskByNumber(number)).instructions).toBe("E2E-taak");
  });

  test("a technician cannot open the edit form", async ({
    page,
    token,
    technicians: { kevin },
  }) => {
    const [number] = await seed(token, kevin, [
      { status: "assigned", scheduledDate: "2031-03-10" },
    ]);
    await signIn(page, TECHNICIAN);
    // `signIn` does not wait for the result: without this the goto can cancel the sign-in.
    await expect(page).toHaveURL("/my-tasks");
    await page.goto(`/tasks/${number}/edit`);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOR_YOU })).toBeVisible();
    await expect(page.getByRole("button", { name: "Wijzigingen bewaren" })).toHaveCount(0);
  });
});
