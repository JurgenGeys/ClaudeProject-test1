import { test as base, expect, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  readProfileId,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
} from "./support/users";

type Fixtures = {
  /** A technician of this test only, so that the filter on technician isolates the tasks of this test. */
  technician: TestUser & { id: string };
  /** A text that only the customer of this test contains; customer and tasks are removed afterwards. */
  token: string;
};

const test = base.extend<Fixtures>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-overview-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Olaf Overzicht ${random}`,
      role: "technician",
    };
    await ensureUser(user);
    await run({ ...user, id: await readProfileId(user.email) });
    await removeTasksOf(user.email);
    await removeUser(user.email);
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

/** The link of a task in the table (laptop) or the cards (phone): only one of them is visible. */
const taskLink = (page: Page, number: number) =>
  page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) });

const tab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Status" })
    .getByRole("link", { name: new RegExp(`^${name}`) });

/**
 * Six tasks of one technician: two Toegewezen, one Opgepikt (since 07:48), one Afgewerkt with
 * corrected hours, one Gefactureerd and one Geannuleerd. Returns their numbers by name.
 */
async function seedTasks(technician: TestUser, token: string) {
  const customerName = `${token} Bakkerij`;
  const customerId = await createCustomer(customerName, BACKOFFICE.email, {
    street: "Gasthuisstraat 23",
    postalCode: "2300",
    city: "Turnhout",
  });
  const [assigned, assignedLater, pickedUp, completed, invoiced, cancelled] =
    await createTasksWithStatus(technician.email, BACKOFFICE.email, customerId, [
      { status: "assigned", scheduledDate: "2031-03-10", startTime: "09:00", city: "Turnhout" },
      { status: "assigned", scheduledDate: "2031-03-12", startTime: "13:30", workType: "repair" },
      {
        status: "picked_up",
        scheduledDate: "2031-03-11",
        startTime: "08:00",
        workType: "maintenance",
        city: "Turnhout",
        instructions: "Jaarlijks onderhoud\nTweede regel",
        pickedUpAt: new Date("2031-03-11T06:48:00Z"),
      },
      {
        status: "completed",
        scheduledDate: "2031-03-05",
        workedMinutes: 120,
        correctedMinutes: 90,
      },
      { status: "invoiced", scheduledDate: "2031-02-01", workedMinutes: 60 },
      { status: "cancelled", scheduledDate: "2031-03-20" },
    ]);
  return { customerName, assigned, assignedLater, pickedUp, completed, invoiced, cancelled };
}

test.describe("the task overview", () => {
  test("the technician filter from the link 'Toon zijn taken' shows only his tasks, with the counts per tab", async ({
    page,
    technician,
    token,
  }) => {
    const t = await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}`);

    await test.step("the technician is selected and the tabs count his tasks", async () => {
      await expect(page.getByLabel("Technieker")).toHaveValue(technician.id);
      await expect(tab(page, "Actief")).toHaveText(/^Actief\s*4/);
      await expect(tab(page, "Open")).toHaveText(/^Open\s*0/);
      await expect(tab(page, "Toegewezen")).toHaveText(/^Toegewezen\s*2/);
      await expect(tab(page, "Opgepikt")).toHaveText(/^Opgepikt\s*1/);
      await expect(tab(page, "Afgewerkt")).toHaveText(/^Afgewerkt\s*1/);
      await expect(tab(page, "Gefactureerd")).toHaveText(/^Gefactureerd\s*1/);
      await expect(tab(page, "Geannuleerd")).toHaveText(/^Geannuleerd\s*1/);
      await expect(tab(page, "Alle")).toHaveText(/^Alle\s*6/);
      await expect(tab(page, "Actief")).toHaveAttribute("aria-current", "page");
    });

    await test.step("Actief shows four tasks, oldest first, and not the cancelled or invoiced ones", async () => {
      for (const number of [t.completed, t.assigned, t.pickedUp, t.assignedLater]) {
        await expect(taskLink(page, number)).toBeVisible();
      }
      await expect(taskLink(page, t.cancelled)).toHaveCount(0);
      await expect(taskLink(page, t.invoiced)).toHaveCount(0);
      const order = await page
        .getByRole("link", { name: /#\d+/ })
        .evaluateAll((links) => links.map((link) => link.textContent?.match(/#(\d+)/)?.[1]));
      expect(order.map(Number)).toEqual([t.completed, t.assigned, t.pickedUp, t.assignedLater]);
    });

    await test.step("a task shows what the design asks for, and since when it is picked up", async () => {
      const picked = taskLink(page, t.pickedUp);
      await expect(picked).toHaveAttribute("href", `/tasks/${t.pickedUp}`);
      const row = page
        .getByRole("row", { name: new RegExp(`#${t.pickedUp}(?!\\d)`) })
        .or(page.getByRole("listitem").filter({ has: picked }));
      const visibleRow = row.filter({ visible: true });
      await expect(visibleRow).toContainText(t.customerName);
      await expect(visibleRow).toContainText("Turnhout");
      await expect(visibleRow).toContainText("Onderhoud");
      await expect(visibleRow).toContainText("Jaarlijks onderhoud");
      await expect(visibleRow).not.toContainText("Tweede regel");
      await expect(visibleRow).toContainText(technician.fullName);
      await expect(visibleRow).toContainText("Opgepikt");
      await expect(visibleRow).toContainText("sinds 07:48");
    });

    await test.step("corrected hours show the hours that count", async () => {
      const card = page
        .getByRole("row", { name: new RegExp(`#${t.completed}(?!\\d)`) })
        .or(page.getByRole("listitem").filter({ has: taskLink(page, t.completed) }))
        .filter({ visible: true });
      await expect(card).toContainText("1u30");
      await expect(card).toContainText("gecorrigeerd");
    });
  });

  test("a tab changes the list and the address, keeps the technician, and is reached with the keyboard", async ({
    page,
    technician,
    token,
  }) => {
    const t = await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}`);

    await tab(page, "Geannuleerd").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/tasks?status=cancelled&technician=${technician.id}`);
    await expect(tab(page, "Geannuleerd")).toHaveAttribute("aria-current", "page");
    await expect(tab(page, "Actief")).not.toHaveAttribute("aria-current", /.*/);
    await expect(taskLink(page, t.cancelled)).toBeVisible();
    await expect(taskLink(page, t.assigned)).toHaveCount(0);
    await expect(page.getByLabel("Technieker")).toHaveValue(technician.id);

    await tab(page, "Afgewerkt").click();
    await expect(page).toHaveURL(`/tasks?status=completed&technician=${technician.id}`);
    await expect(taskLink(page, t.completed)).toBeVisible();
    await expect(taskLink(page, t.pickedUp)).toHaveCount(0);

    await tab(page, "Alle").click();
    await expect(taskLink(page, t.cancelled)).toBeVisible();
    await expect(taskLink(page, t.invoiced)).toBeVisible();
  });

  test("the filter form sets technician and period in the address, and 'Filters wissen' removes them", async ({
    page,
    technician,
    token,
  }) => {
    const t = await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto("/tasks");

    await page.getByLabel("Technieker").selectOption(technician.id);
    await page.getByLabel("Van").fill("2031-03-11");
    await page.getByLabel("Tot en met").fill("2031-03-12");
    await page.getByRole("button", { name: "Filteren" }).click();

    await expect(page).toHaveURL(
      `/tasks?technician=${technician.id}&from=2031-03-11&to=2031-03-12`,
    );
    await expect(taskLink(page, t.pickedUp)).toBeVisible();
    await expect(taskLink(page, t.assignedLater)).toBeVisible();
    await expect(taskLink(page, t.assigned)).toHaveCount(0);
    await expect(taskLink(page, t.completed)).toHaveCount(0);
    // The counts follow the period as well.
    await expect(tab(page, "Actief")).toHaveText(/^Actief\s*2/);

    await page.getByRole("link", { name: "Filters wissen" }).click();
    await expect(page).toHaveURL("/tasks");
    await expect(page.getByLabel("Technieker")).toHaveValue("");
    await expect(page.getByLabel("Van")).toHaveValue("");
  });

  test("a filter without result says so and can be cleared", async ({
    page,
    technician,
    token,
  }) => {
    await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}&from=2020-01-01&to=2020-01-02`);

    await expect(page.getByText("Geen taken gevonden voor deze filter.")).toBeVisible();
    await page.getByRole("link", { name: "Filters wissen" }).last().click();
    await expect(page).toHaveURL("/tasks");
  });

  test("an empty tab for a technician says that no tasks were found", async ({
    page,
    technician,
    token,
  }) => {
    // The technician has tasks, but none that is Open: the tab is empty. (Without any task in
    // the database at all the page shows "Er zijn nog geen taken" and no tabs, so a task is needed.)
    await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?status=open&technician=${technician.id}`);
    await expect(page.getByText("Geen taken gevonden voor deze filter.")).toBeVisible();
  });

  test("invalid parameters are ignored: the default overview opens", async ({
    page,
    technician,
    token,
  }) => {
    // A task makes sure the tabs are there: with no task at all the page shows the empty state.
    await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(
      "/tasks?status=bogus&technician=not-a-uuid&from=2026-02-30&to=morgen&technician=x",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Taken" })).toBeVisible();
    await expect(tab(page, "Actief")).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Technieker")).toHaveValue("");
    await expect(page.getByLabel("Van")).toHaveValue("");
    await expect(page.getByLabel("Tot en met")).toHaveValue("");
  });

  test("an unknown technician id is ignored too, instead of showing an empty list for 'Alle techniekers'", async ({
    page,
    technician,
    token,
  }) => {
    await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto("/tasks?technician=6f1c1c7e-4f55-4c3b-9d33-000000000000");
    await expect(page.getByLabel("Technieker")).toHaveValue("");
    await expect(tab(page, "Actief")).toHaveAttribute("aria-current", "page");
    // The tasks of the other technician are still among the tasks that are shown.
    await expect(page.getByRole("link", { name: /#\d+/ }).first()).toBeVisible();
  });

  test("the 'Nieuwe taak' button works, and the overview no longer shows a confirmation from the address", async ({
    page,
  }) => {
    await signInAsBackoffice(page);
    // The confirmation "Taak #N bewaard." now lives on the task page (BT-10).
    await page.goto("/tasks?saved=1051");
    await expect(page.getByRole("heading", { level: 1, name: "Taken" })).toBeVisible();
    await expect(page.getByText(/bewaard/)).toHaveCount(0);
    await page.getByRole("link", { name: "Nieuwe taak" }).click();
    await expect(page).toHaveURL("/tasks/new");
  });

  test("the page does not scroll sideways, on a phone or a laptop", async ({
    page,
    technician,
    token,
  }) => {
    await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}&status=all`);
    await expect(tab(page, "Alle")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("on a phone the tasks are cards, on a laptop a table", async ({
    page,
    technician,
    token,
  }, testInfo) => {
    const t = await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}`);
    await expect(taskLink(page, t.assigned)).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Taken" })).toBeVisible();
    } else {
      await expect(page.getByRole("table", { name: "Taken" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Taken" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Nr." })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Soort" })).toBeVisible();
    }
  });

  test("the filter form follows the address: 'Filters wissen', a tab and the Back button never leave old values behind", async ({
    page,
    technician,
    token,
  }) => {
    await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}&from=2031-03-11&to=2031-03-12`);
    await expect(page.getByLabel("Van")).toHaveValue("2031-03-11");

    await page.getByRole("link", { name: "Filters wissen" }).click();
    await expect(page).toHaveURL("/tasks");
    await expect(page.getByLabel("Technieker")).toHaveValue("");
    await expect(page.getByLabel("Van")).toHaveValue("");
    await expect(page.getByLabel("Tot en met")).toHaveValue("");

    await test.step("Back restores the filters in the form", async () => {
      await page.goBack();
      await expect(page).toHaveURL(
        `/tasks?technician=${technician.id}&from=2031-03-11&to=2031-03-12`,
      );
      await expect(page.getByLabel("Technieker")).toHaveValue(technician.id);
      await expect(page.getByLabel("Van")).toHaveValue("2031-03-11");
      await expect(page.getByLabel("Tot en met")).toHaveValue("2031-03-12");
    });

    await test.step("Forward clears them again", async () => {
      await page.goForward();
      await expect(page).toHaveURL("/tasks");
      await expect(page.getByLabel("Technieker")).toHaveValue("");
      await expect(page.getByLabel("Van")).toHaveValue("");
    });

    await test.step("a tab keeps the period in the form, and Back returns to the first tab", async () => {
      await page.goto(`/tasks?technician=${technician.id}&from=2031-03-11&to=2031-03-12`);
      await tab(page, "Opgepikt").click();
      await expect(page).toHaveURL(
        `/tasks?status=picked_up&technician=${technician.id}&from=2031-03-11&to=2031-03-12`,
      );
      await expect(page.getByLabel("Van")).toHaveValue("2031-03-11");
      await page.goBack();
      await expect(tab(page, "Actief")).toHaveAttribute("aria-current", "page");
      await expect(page.getByLabel("Tot en met")).toHaveValue("2031-03-12");
    });
  });

  test("an end date before the start date gives a message at the field and does not filter", async ({
    page,
    technician,
    token,
  }) => {
    const t = await seedTasks(technician, token);
    await signInAsBackoffice(page);
    await page.goto(`/tasks?technician=${technician.id}&from=2031-03-12&to=2031-03-10`);

    const to = page.getByLabel("Tot en met");
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect(to).toHaveAccessibleDescription("De einddatum ligt vóór de begindatum.");
    await expect(page.getByLabel("Van")).toHaveValue("2031-03-12");
    // All four active tasks are still listed: the impossible period is not applied.
    await expect(tab(page, "Actief")).toHaveText(/^Actief\s*4/);
    await expect(taskLink(page, t.assigned)).toBeVisible();
    await expect(taskLink(page, t.assignedLater)).toBeVisible();
    await expect(page.getByText("Geen taken gevonden voor deze filter.")).toHaveCount(0);
  });

  test.describe("with more than 50 tasks", () => {
    // One task more than a page: 51 for the technician of this test.
    test("pages of 50 with 'Vorige' and 'Volgende', keeping the filters; the tab count is the total", async ({
      page,
      technician,
      token,
    }) => {
      test.setTimeout(120_000);
      const customerId = await createCustomer(`${token} Pagina`, BACKOFFICE.email, {
        street: "Gasthuisstraat 23",
        postalCode: "2300",
        city: "Turnhout",
      });
      const numbers = await createTasksWithStatus(
        technician.email,
        BACKOFFICE.email,
        customerId,
        Array.from({ length: 51 }, (_, i) => ({
          status: "assigned" as const,
          scheduledDate: `2032-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
        })),
      );
      await signInAsBackoffice(page);
      const base = `/tasks?technician=${technician.id}`;
      await page.goto(base);

      /** The task numbers that are linked on the page (a row has two links on a laptop). */
      const shown = async () =>
        [
          ...new Set(
            await page
              .locator("a[href]:visible")
              .evaluateAll((links) =>
                links
                  .map((l) => l.getAttribute("href")?.match(/^\/tasks\/(\d+)$/)?.[1])
                  .filter(Boolean),
              ),
          ),
        ].map(Number);

      await test.step("page 1 has 50 tasks and the tab says 51", async () => {
        await expect(tab(page, "Actief")).toHaveText(/^Actief\s*51/);
        await expect.poll(shown).toEqual(numbers.slice(0, 50));
        const nav = page.getByRole("navigation", { name: "Paginering" });
        await expect(nav).toContainText("Taken 1 tot 50 van 51 (pagina 1 van 2)");
        await expect(nav.getByRole("link", { name: "Vorige" })).toHaveCount(0);
      });

      await test.step("'Volgende' shows the last task and keeps the technician", async () => {
        await page.getByRole("link", { name: "Volgende" }).click();
        await expect(page).toHaveURL(`${base}&page=2`);
        await expect(page.getByLabel("Technieker")).toHaveValue(technician.id);
        await expect.poll(shown).toEqual([numbers[50]]);
        await expect(tab(page, "Actief")).toHaveText(/^Actief\s*51/);
        await expect(
          page
            .getByRole("navigation", { name: "Paginering" })
            .getByRole("link", { name: "Volgende" }),
        ).toHaveCount(0);
      });

      await test.step("'Vorige' returns to the first page", async () => {
        await page.getByRole("link", { name: "Vorige" }).click();
        await expect(page).toHaveURL(base);
        await expect.poll(shown).toEqual(numbers.slice(0, 50));
      });

      await test.step("a page that is too high shows the last page; an invalid one the first", async () => {
        await page.goto(`${base}&page=99`);
        await expect.poll(shown).toEqual([numbers[50]]);
        await page.goto(`${base}&page=abc`);
        await expect.poll(shown).toEqual(numbers.slice(0, 50));
        await page.goto(`${base}&page=0`);
        await expect.poll(shown).toEqual(numbers.slice(0, 50));
      });

      await test.step("choosing a tab goes back to the first page", async () => {
        await page.goto(`${base}&page=2`);
        await tab(page, "Toegewezen").click();
        await expect(page).toHaveURL(`/tasks?status=assigned&technician=${technician.id}`);
      });
    });
  });
});
