import { test as base, expect, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, TECHNICIAN, type TestUser } from "./support/test-users";
import {
  countTasksOfCustomersNamed,
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  readCustomersNamed,
  readTaskByNumber,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

const NOT_FOR_YOU = "Deze pagina is niet voor jou bedoeld";

type Fixtures = {
  /** A technician of this test only, with a name that no other test uses. Removed afterwards. */
  technician: TestUser;
  /** A text that only the customers of this test contain; they and their tasks are removed afterwards. */
  token: string;
};

const test = base.extend<Fixtures>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-customers-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Klaas Klant ${random}`,
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

/** Opens a page with a form and waits until React took the page over (the button does nothing before). */
async function openCustomerForm(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.locator('form[data-hydrated="true"]:visible').waitFor();
}

/** Searches in the customer list (B5), a plain GET form, and waits for the new URL. */
async function searchList(page: Page, text: string): Promise<void> {
  await page.getByRole("searchbox", { name: "Zoeken" }).fill(text);
  await page.getByRole("button", { name: "Zoeken", exact: true }).click();
  await expect(page).toHaveURL(/\/customers\?q=/);
}

test.describe("the customer list (B5)", () => {
  test("lists and searches customers by name, city and phone number, with the number of tasks", async ({
    page,
    token,
    technician,
  }) => {
    const bakkerij = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    await createCustomer(`${token} Slagerij`, BACKOFFICE.email, {
      street: "Dorp 4",
      postalCode: "2381",
      city: "Weelde",
      phone: "0485 33 19 08",
    });
    await createTasksWithStatus(technician.email, BACKOFFICE.email, bakkerij, [
      { status: "assigned", scheduledDate: "2030-03-15" },
      { status: "cancelled", scheduledDate: "2030-05-02" },
    ]);

    await signInAsBackoffice(page);
    await page.goto("/customers");
    await expect(page.getByRole("heading", { level: 1, name: "Klanten" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nieuwe klant" })).toBeVisible();

    await test.step("a search on the unique text finds both, sorted by name", async () => {
      await searchList(page, token);
      await expect(page.getByRole("link", { name: `${token} Bakkerij` })).toBeVisible();
      await expect(page.getByRole("link", { name: `${token} Slagerij` })).toBeVisible();
    });

    await test.step("the line shows the address, the phone number and the tasks", async () => {
      // On a laptop a table row, on a phone a card: both show the same facts as text.
      await expect(page.getByText("Gasthuisstraat 23, 2300 Turnhout").first()).toBeVisible();
      await expect(page.getByText("014 41 22 87").first()).toBeVisible();
      // Two tasks (a cancelled one counts), the latest planned on 02/05/2030.
      await expect(page.getByText(/02\/05\/2030/).first()).toBeVisible();
    });

    await test.step("the phone number is found without the spaces", async () => {
      await searchList(page, "014412287");
      await expect(page.getByRole("link", { name: `${token} Bakkerij` })).toBeVisible();
      await expect(page.getByRole("link", { name: `${token} Slagerij` })).toHaveCount(0);
    });

    await test.step("and by city", async () => {
      await searchList(page, "weelde");
      await expect(page.getByRole("link", { name: `${token} Slagerij` })).toBeVisible();
      await expect(page.getByRole("link", { name: `${token} Bakkerij` })).toHaveCount(0);
    });

    await test.step("a search without a result says so and offers a way out", async () => {
      await searchList(page, `${token} bestaatniet`);
      await expect(
        page.getByText(`Geen klant gevonden voor '${token} bestaatniet'.`),
      ).toBeVisible();
      await page.getByRole("link", { name: "Alle klanten tonen" }).click();
      await expect(page).toHaveURL("/customers");
    });
  });

  test("a customer in the list opens his page", async ({ page, token }) => {
    await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    await signInAsBackoffice(page);
    await page.goto(`/customers?q=${token}`);
    await page.getByRole("link", { name: `${token} Bakkerij` }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: `${token} Bakkerij` })).toBeVisible();
  });
});

test.describe("a customer (B6)", () => {
  test("a new customer with mistakes is refused, and saved once corrected", async ({
    page,
    token,
  }) => {
    await signInAsBackoffice(page);
    await openCustomerForm(page, "/customers/new", "Nieuwe klant");

    await test.step("an empty name, a wrong postal code and a wrong e-mail address are refused", async () => {
      await page.getByLabel("Postcode").fill("23");
      await page.getByLabel("E-mail").fill("geen-mailadres");
      await page.getByRole("button", { name: "Klant bewaren" }).click();

      const summary = page.getByRole("alert").filter({ hasText: "De klant is niet bewaard" });
      await expect(summary).toHaveText(
        "De klant is niet bewaard. Verbeter de 3 gemarkeerde velden.",
      );
      await expect(summary).toBeFocused();
      await expect(page).toHaveURL("/customers/new");
      await expect(page.getByLabel(/^Naam/)).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByLabel(/^Naam/)).toHaveAccessibleDescription(
        "Vul de naam van de klant in.",
      );
      await expect(page.getByLabel("Postcode")).toHaveAccessibleDescription(
        "Vul een geldige postcode in (4 cijfers).",
      );
      await expect(page.getByLabel("E-mail")).toHaveAccessibleDescription(
        "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
      );
      // What was typed stays.
      await expect(page.getByLabel("Postcode")).toHaveValue("23");
      expect(await readCustomersNamed(token)).toEqual([]);
    });

    await test.step("corrected, it is saved and its page shows 'Klant bewaard.'", async () => {
      await page.getByLabel(/^Naam/).fill(`${token} Nieuw`);
      await page.getByLabel("Straat en nummer").fill("Nieuwstraat 7");
      await page.getByLabel("Postcode").fill("9000");
      await page.getByLabel("Gemeente").fill("Gent");
      await page.getByLabel("Telefoon").fill("0470 12 34 56");
      await page.getByLabel("E-mail").fill("info@nieuw.example");
      await page.getByLabel("Opmerkingen").fill("Sleutel bij de buren op nr. 14");
      await page.getByRole("button", { name: "Klant bewaren" }).click();

      await expect(page.getByRole("status").filter({ hasText: "Klant bewaard." })).toBeVisible();
      await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { level: 1, name: `${token} Nieuw` })).toBeVisible();
      expect(await readCustomersNamed(token)).toMatchObject([
        {
          name: `${token} Nieuw`,
          street: "Nieuwstraat 7",
          postalCode: "9000",
          city: "Gent",
          phone: "0470 12 34 56",
          email: "info@nieuw.example",
          notes: "Sleutel bij de buren op nr. 14",
          createdByEmail: BACKOFFICE.email,
        },
      ]);
      await expect(page.getByText("Er zijn nog geen taken voor deze klant.")).toBeVisible();
    });
  });

  test("a customer can be changed; the location of his existing task stays as it was", async ({
    page,
    token,
    technician,
  }) => {
    const id = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    const [number] = await createTasksWithStatus(technician.email, BACKOFFICE.email, id, [
      { status: "assigned", scheduledDate: "2030-03-15", workType: "repair", city: "Gent" },
    ]);

    await signInAsBackoffice(page);
    await openCustomerForm(page, `/customers/${id}`, `${token} Bakkerij`);
    await expect(page.getByLabel("Gemeente")).toHaveValue("Turnhout");

    await page.getByLabel("Gemeente").fill("Retie");
    await page.getByLabel("Telefoon").fill("");
    await page.getByRole("button", { name: "Klant bewaren" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Klant bewaard." })).toBeVisible();
    await expect(page.getByLabel("Gemeente")).toHaveValue("Retie");
    expect(await readCustomersNamed(token)).toMatchObject([
      { city: "Retie", phone: null, street: "Gasthuisstraat 23" },
    ]);
    // The task has its own location: it did not change.
    expect(await readTaskByNumber(number)).toMatchObject({
      locationCity: "Gent",
      customerCity: "Retie",
    });

    await test.step("a reload does not show the confirmation again", async () => {
      await page.reload();
      await expect(page.getByLabel("Gemeente")).toHaveValue("Retie");
      await expect(page.getByText("Klant bewaard.")).toHaveCount(0);
    });
  });

  test("the tasks of the customer are listed, cancelled ones too, and open the task", async ({
    page,
    token,
    technician,
  }) => {
    const id = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    const [planned, cancelled] = await createTasksWithStatus(
      technician.email,
      BACKOFFICE.email,
      id,
      [
        {
          status: "assigned",
          scheduledDate: "2030-03-15",
          workType: "maintenance",
          instructions: "Jaarlijks onderhoud\nTweede regel",
        },
        {
          status: "cancelled",
          scheduledDate: "2030-02-01",
          workType: "repair",
          instructions: "Toestel lekt",
        },
      ],
    );

    await signInAsBackoffice(page);
    await page.goto(`/customers/${id}`);
    const tasks = page.getByRole("region", { name: "Taken voor deze klant" });
    const items = tasks.getByRole("link");
    await expect(items).toHaveCount(2);
    // Newest planned day first.
    await expect(items.nth(0)).toContainText(`#${planned}`);
    await expect(items.nth(0)).toContainText("Onderhoud");
    await expect(items.nth(0)).toContainText(technician.fullName);
    await expect(items.nth(0)).toContainText("Jaarlijks onderhoud");
    await expect(items.nth(0)).not.toContainText("Tweede regel");
    await expect(items.nth(0)).toContainText("Toegewezen");
    await expect(items.nth(1)).toContainText(`#${cancelled}`);
    await expect(items.nth(1)).toContainText("Geannuleerd");

    await items.nth(0).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${planned}$`));
  });

  test("'Nieuwe taak voor deze klant' opens the task form with the customer and his address", async ({
    page,
    token,
  }) => {
    const id = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    await signInAsBackoffice(page);
    await page.goto(`/customers/${id}`);
    await page.getByRole("link", { name: "+ Nieuwe taak voor deze klant" }).click();
    await expect(page).toHaveURL(`/tasks/new?customer=${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Nieuwe taak" })).toBeVisible();
    await page.locator('form[data-hydrated="true"]:visible').waitFor();

    await expect(page.getByText(`${token} Bakkerij`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Andere klant kiezen" })).toBeVisible();
    await expect(page.getByLabel("Straat en nummer")).toHaveValue("Gasthuisstraat 23");
    await expect(page.getByLabel("Postcode")).toHaveValue("2300");
    await expect(page.getByLabel("Gemeente")).toHaveValue("Turnhout");

    await page.getByRole("radio", { name: "Nazicht" }).check();
    await page.getByLabel("Instructies").fill("Nazicht koeling");
    await page.getByLabel(/^Datum/).fill("2030-03-15");
    await page.getByLabel(/^Startuur/).fill("09:00");
    await page.getByRole("button", { name: "Taak bewaren" }).click();
    await expect(page).toHaveURL(/\/tasks\/\d+(\?saved=1)?$/);

    expect(await countTasksOfCustomersNamed(token)).toBe(1);
  });

  test("an id that is not a customer gives the 'not found' page", async ({ page }) => {
    await signInAsBackoffice(page);
    for (const id of ["00000000-0000-4000-8000-000000000000", "geen-uuid"]) {
      await page.goto(`/customers/${id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Deze klant bestaat niet (meer)." }),
      ).toBeVisible();
    }
  });
});

test.describe("phone numbers in the customer picker of the task form", () => {
  test("a number typed without spaces finds the customer", async ({ page, token }) => {
    await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
      phone: "014 41 22 87",
    });
    await signInAsBackoffice(page);
    await page.goto("/tasks/new");
    await page.locator('form[data-hydrated="true"]:visible').waitFor();
    await page.getByLabel("Zoek een klant").fill("014412287");
    await expect(
      page
        .getByRole("list", { name: "Gevonden klanten" })
        .getByRole("button", { name: new RegExp(`${token} Bakkerij`) }),
    ).toBeVisible();
  });
});

test.describe("access", () => {
  test("a technician does not get the customer screens", async ({ page, token }) => {
    const id = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Dorp 4",
      postalCode: "2381",
      city: "Weelde",
    });
    await signIn(page, TECHNICIAN);
    await expect(page).toHaveURL("/my-tasks");
    for (const path of ["/customers", "/customers/new", `/customers/${id}`]) {
      await page.goto(path);
      await expect(page.getByText(NOT_FOR_YOU)).toBeVisible();
      await expect(page.getByText(`${token} Bakkerij`)).toHaveCount(0);
    }
  });
});
