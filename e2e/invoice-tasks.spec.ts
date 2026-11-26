import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  changeTaskInstructions,
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  invoiceTaskAsOffice,
  readProfileId,
  readTaskInvoicing,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

// "Markeer als gefactureerd" (BT-17): the selection in B1 (tab Afgewerkt) and the button in B3.
// Every test makes its own technician, customer and tasks, and removes them afterwards; the
// technician filter keeps the tasks of other tests out of the list. A colleague acts "behind the
// back" of an open page through the database.

type Fixtures = {
  technician: TestUser & { id: string };
  /** A text that only the customer of this test contains; customer and tasks are removed afterwards. */
  token: string;
};

const test = base.extend<Fixtures>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-invoice-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Fenna Factuur ${random}`,
      role: "technician",
    };
    await ensureUser(user);
    await run({ ...user, id: await readProfileId(user.email) });
    await removeTasksOf(user.email);
    await removeUser(user.email);
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxinv${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
});

async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

async function seedCompleted(technician: TestUser, token: string, count: number) {
  const customerName = `${token} Bakkerij`;
  const customerId = await createCustomer(customerName, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
  const numbers = await createTasksWithStatus(
    technician.email,
    BACKOFFICE.email,
    customerId,
    Array.from({ length: count }, (_, index) => ({
      status: "completed" as const,
      // Different days, so the order of the list is known (newest first).
      scheduledDate: `2031-04-${String(count - index).padStart(2, "0")}`,
      workedMinutes: 90,
    })),
  );
  return { customerName, numbers };
}

/** Everything is looked up among the visible elements: table and cards are both in the page, and Next keeps the previous route hidden. */
const taskBox = (page: Page, number: number): Locator =>
  page.getByRole("checkbox", { name: new RegExp(`^Selecteer taak #${number},`) });
const allBox = (page: Page): Locator =>
  page.getByRole("checkbox", { name: "Alles selecteren op deze pagina" });
const tab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Status" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
const taskLink = (page: Page, number: number) =>
  page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) });

test.describe("marking tasks as invoiced in the overview (B1)", () => {
  test("tick tasks, see the bar, confirm, and find them under Gefactureerd", async ({
    page,
    technician,
    token,
  }) => {
    const { numbers } = await seedCompleted(technician, token, 3);
    const [first, second, third] = numbers;
    await signInAsBackoffice(page);
    await page.goto(`/tasks?status=completed&technician=${technician.id}`);
    await expect(taskLink(page, first)).toBeVisible();

    await test.step("there is no bar until something is ticked", async () => {
      await expect(page.getByRole("button", { name: "Markeer als gefactureerd" })).toHaveCount(0);
    });

    await test.step("every checkbox has a target of at least 44 by 44 px", async () => {
      for (const box of [taskBox(page, first), allBox(page)]) {
        const target = await box.locator("xpath=ancestor::label").boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.height).toBeGreaterThanOrEqual(44);
      }
    });

    await test.step("the bar counts the selection", async () => {
      await taskBox(page, first).click();
      await expect(page.getByText("1 taak geselecteerd")).toBeVisible();
      await taskBox(page, second).click();
      await expect(page.getByText("2 taken geselecteerd")).toBeVisible();
      await allBox(page).click();
      await expect(page.getByText("3 taken geselecteerd")).toBeVisible();
      await allBox(page).click();
      await expect(page.getByText(/geselecteerd/)).toHaveCount(0);
    });

    await test.step("the keyboard works: Space ticks a checkbox", async () => {
      await taskBox(page, third).focus();
      await page.keyboard.press("Space");
      await expect(page.getByText("1 taak geselecteerd")).toBeVisible();
      await taskBox(page, first).focus();
      await page.keyboard.press("Space");
    });

    await test.step("the confirmation asks the question of the design, and Annuleren changes nothing", async () => {
      await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
      const dialog = page.getByRole("dialog", { name: "2 taken markeren als gefactureerd?" });
      await expect(dialog).toContainText(
        "De uren van deze taken kunnen daarna niet meer gewijzigd worden.",
      );
      await dialog.getByRole("button", { name: "Annuleren" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect((await readTaskInvoicing(first)).status).toBe("completed");
      await expect(page.getByText("2 taken geselecteerd")).toBeVisible();
    });

    await test.step("confirming marks them, with who and when", async () => {
      await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Markeer als gefactureerd" })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "2 taken gemarkeerd als gefactureerd." }),
      ).toBeVisible();
      await expect(taskLink(page, first)).toHaveCount(0);
      await expect(taskLink(page, third)).toHaveCount(0);
      await expect(taskLink(page, second)).toBeVisible();
      await expect(page.getByText(/geselecteerd/)).toHaveCount(0);
      for (const number of [first, third]) {
        const state = await readTaskInvoicing(number);
        expect(state).toMatchObject({ status: "invoiced", invoicedByEmail: BACKOFFICE.email });
        expect(state.invoicedAt).not.toBeNull();
      }
      expect((await readTaskInvoicing(second)).status).toBe("completed"); // not ticked
    });

    await test.step("the tasks are under Gefactureerd, and the tab Afgewerkt counts what is left", async () => {
      await expect(tab(page, "Afgewerkt")).toHaveText(/^Afgewerkt\s*1/);
      await expect(tab(page, "Gefactureerd")).toHaveText(/^Gefactureerd\s*2/);
      await tab(page, "Gefactureerd").click();
      await expect(taskLink(page, first)).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
    });
  });

  test("a task that was invoiced by a colleague is reported, the rest is marked", async ({
    page,
    technician,
    token,
  }) => {
    const { numbers } = await seedCompleted(technician, token, 2);
    const [first, second] = numbers;
    await signInAsBackoffice(page);
    await page.goto(`/tasks?status=completed&technician=${technician.id}`);
    await allBox(page).click();

    await invoiceTaskAsOffice(second, BACKOFFICE.email);

    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    const notice = page.getByRole("status").filter({ hasText: "gemarkeerd als gefactureerd" });
    await expect(notice).toContainText("Taak gemarkeerd als gefactureerd.");
    await expect(notice).toContainText("1 taak was al gefactureerd.");
    expect((await readTaskInvoicing(first)).status).toBe("invoiced");
  });

  test("a task that changed after the list was opened is not marked, and the notice says so", async ({
    page,
    technician,
    token,
  }) => {
    const { numbers } = await seedCompleted(technician, token, 2);
    const [first, second] = numbers;
    await signInAsBackoffice(page);
    await page.goto(`/tasks?status=completed&technician=${technician.id}`);
    await allBox(page).click();

    await changeTaskInstructions(first, "Aangepaste instructies");

    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    const notice = page.getByRole("status").filter({ hasText: "gemarkeerd als gefactureerd" });
    await expect(notice).toContainText("1 taak is intussen gewijzigd en is niet gemarkeerd.");
    expect((await readTaskInvoicing(first)).status).toBe("completed");
    expect((await readTaskInvoicing(second)).status).toBe("invoiced");
    // The list was refreshed: the changed task is still there, and can be marked now.
    await expect(taskLink(page, first)).toBeVisible();
    await taskBox(page, first).click();
    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Taak gemarkeerd als gefactureerd." }),
    ).toBeVisible();
    expect((await readTaskInvoicing(first)).status).toBe("invoiced");
  });

  test("the selection is per page: 'Alles selecteren' takes the 50 tasks of the page", async ({
    page,
    technician,
    token,
  }) => {
    test.setTimeout(120_000);
    // 51 tasks: one more than a page. One day, start times a quarter of an hour apart.
    const customerId = await createCustomer(`${token} Groot`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    const numbers = await createTasksWithStatus(
      technician.email,
      BACKOFFICE.email,
      customerId,
      Array.from({ length: 51 }, (_, index) => ({
        status: "completed" as const,
        scheduledDate: `2031-05-01`,
        startTime: `${String(Math.floor(index / 4) + 6).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
      })),
    );
    await signInAsBackoffice(page);
    await page.goto(`/tasks?status=completed&technician=${technician.id}`);
    await expect(tab(page, "Afgewerkt")).toHaveText(/^Afgewerkt\s*51/);

    await allBox(page).click();
    await expect(page.getByText("50 taken geselecteerd")).toBeVisible();

    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "50 taken gemarkeerd als gefactureerd." }),
    ).toBeVisible();
    // One task is left, on the first page now.
    await expect(tab(page, "Afgewerkt")).toHaveText(/^Afgewerkt\s*1/);
    const states = await Promise.all(numbers.map((number) => readTaskInvoicing(number)));
    expect(states.filter((state) => state.status === "invoiced")).toHaveLength(50);
    expect(states.filter((state) => state.status === "completed")).toHaveLength(1);
  });
});

test.describe("marking one task as invoiced (B3)", () => {
  test("mark it, see the locked hours, take the mark off again", async ({
    page,
    technician,
    token,
  }) => {
    const { numbers } = await seedCompleted(technician, token, 1);
    const [number] = numbers;
    await signInAsBackoffice(page);
    await page.goto(`/tasks/${number}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(token);

    await test.step("an Afgewerkt task has the button, with the confirmation of the design", async () => {
      await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
      const dialog = page.getByRole("dialog", { name: "Markeren als gefactureerd?" });
      await expect(dialog).toContainText(
        "De uren van deze taak kunnen daarna niet meer gewijzigd worden.",
      );
      await dialog.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    });

    await test.step("the page confirms, shows the status and locks the hours", async () => {
      await expect(page.getByRole("status")).toContainText("Taak gemarkeerd als gefactureerd.");
      await expect(page).toHaveURL(`/tasks/${number}`);
      await expect(page.getByText("Gefactureerd", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("region", { name: "Afmelding" })).toContainText(
        "gefactureerde uren · vergrendeld",
      );
      await expect(page.getByRole("button", { name: "Markeer als gefactureerd" })).toHaveCount(0);
      expect(await readTaskInvoicing(number)).toMatchObject({
        status: "invoiced",
        invoicedByEmail: BACKOFFICE.email,
      });
      await expect(page.getByRole("region", { name: "Tijdlijn" })).toContainText(
        `door ${BACKOFFICE.fullName}`,
      );
    });

    await test.step("the confirmation does not come back after a reload", async () => {
      await page.reload();
      await expect(page.getByRole("status")).toHaveCount(0);
    });

    await test.step("the mark can be taken off, with the text of the design", async () => {
      await page.getByRole("button", { name: "Markering ongedaan maken" }).click();
      const dialog = page.getByRole("dialog", { name: "Markering ongedaan maken?" });
      await expect(dialog).toContainText(
        "De taak staat dan terug op Afgewerkt en de uren kunnen weer gewijzigd worden.",
      );
      await dialog.getByRole("button", { name: "Ongedaan maken" }).click();
      await expect(page.getByRole("status")).toContainText("Markering ongedaan gemaakt.");
      await expect(page.getByRole("button", { name: "Markeer als gefactureerd" })).toBeVisible();
      expect(await readTaskInvoicing(number)).toMatchObject({
        status: "completed",
        invoicedAt: null,
        invoicedByEmail: null,
      });
      await expect(page.getByRole("region", { name: "Tijdlijn" })).toContainText(
        "Nog niet gefactureerd",
      );
    });
  });

  test("a task that a colleague invoiced meanwhile gives a message and a reload button", async ({
    page,
    technician,
    token,
  }) => {
    const { numbers } = await seedCompleted(technician, token, 1);
    const [number] = numbers;
    await signInAsBackoffice(page);
    await page.goto(`/tasks/${number}`);
    await expect(page.getByRole("button", { name: "Markeer als gefactureerd" })).toBeVisible();

    await invoiceTaskAsOffice(number, BACKOFFICE.email);

    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Deze taak is al gefactureerd.");
    await page.getByRole("button", { name: "Pagina herladen" }).click();
    await expect(page.getByRole("button", { name: "Markering ongedaan maken" })).toBeVisible();
  });

  test("a task that was changed after the page was opened is not marked", async ({
    page,
    technician,
    token,
  }) => {
    const { numbers } = await seedCompleted(technician, token, 1);
    const [number] = numbers;
    await signInAsBackoffice(page);
    await page.goto(`/tasks/${number}`);
    await expect(page.getByRole("button", { name: "Markeer als gefactureerd" })).toBeVisible();

    await changeTaskInstructions(number, "Aangepaste instructies");

    await page.getByRole("button", { name: "Markeer als gefactureerd" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Markeer als gefactureerd" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
    );
    expect((await readTaskInvoicing(number)).status).toBe("completed");
  });

  test("the other statuses have no invoicing button", async ({ page, technician, token }) => {
    const customerId = await createCustomer(`${token} Open`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    const [assigned] = await createTasksWithStatus(technician.email, BACKOFFICE.email, customerId, [
      { status: "assigned", scheduledDate: "2031-04-01" },
    ]);
    await signInAsBackoffice(page);
    await page.goto(`/tasks/${assigned}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(token);
    await expect(page.getByRole("button", { name: /gefactureerd|ongedaan/ })).toHaveCount(0);
  });
});
