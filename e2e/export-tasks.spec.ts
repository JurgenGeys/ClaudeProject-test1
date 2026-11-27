import { readFile } from "node:fs/promises";

import { test as base, expect, type Page } from "@playwright/test";

import { signIn } from "./support/sign-in";
import { BACKOFFICE, type TestUser } from "./support/test-users";
import {
  createCustomer,
  createTasksWithStatus,
  ensureUser,
  removeCustomersNamed,
  removeTasksOf,
  removeUser,
  setTaskCompletedAt,
} from "./support/users";

// "Exporteren voor de facturatie" (BT-16): the screen B4 and the CSV file. Every test makes its
// own technician, customer and tasks, and puts the completion of its tasks on a day of its own
// (desktop and mobile run side by side), so the file holds exactly the tasks of the test.

type Fixtures = {
  technician: TestUser;
  token: string;
  /** A day (`2032-03-10`) that only this test and project use for completions. */
  day: string;
};

const test = base.extend<Fixtures>({
  technician: async ({}, run, testInfo) => {
    const random = Math.random().toString(36).slice(2, 8);
    const user: TestUser = {
      email: `e2e-export-${testInfo.project.name}-${Date.now()}-${random}@example.com`,
      fullName: `Evi Export ${random}`,
      role: "technician",
    };
    await ensureUser(user);
    await run(user);
    await removeTasksOf(user.email);
    await removeUser(user.email);
  },
  token: async ({}, run, testInfo) => {
    const token = `Zqxexp${testInfo.project.name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await run(token);
    await removeCustomersNamed(token);
  },
  day: async ({}, run, testInfo) => {
    // Desktop and mobile run side by side, and so do workers: every combination has its own day,
    // and the day after it (used for a task outside the period) is nobody else's.
    const offset = testInfo.project.name === "mobile" ? 12 : 10;
    await run(addDays("2032-03-01", offset + testInfo.parallelIndex * 4));
  },
});

const at = (day: string, time: string) => new Date(`${day}T${time}Z`);

/** `2032-03-01` plus a number of days, as a real calendar day (never `2032-03-32`). */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `2032-03-05` as `05/03/2032`. */
const shown = (day: string) => day.split("-").reverse().join("/");

async function signInAsBackoffice(page: Page): Promise<void> {
  await signIn(page, BACKOFFICE);
  await expect(page).toHaveURL("/tasks");
}

async function openExportPage(page: Page, query = ""): Promise<void> {
  await page.goto(`/tasks/export${query}`);
  await page.locator('form[data-hydrated="true"]').waitFor();
}

test.describe("the export for invoicing (B4)", () => {
  test("downloads the file with the right tasks, hours and protection, and offers the tab Afgewerkt", async ({
    page,
    technician,
    token,
    day,
  }) => {
    const customerId = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    const [plain, corrected, invoiced, cancelled, other] = await createTasksWithStatus(
      technician.email,
      BACKOFFICE.email,
      customerId,
      [
        {
          status: "completed",
          scheduledDate: "2032-03-01",
          workedMinutes: 75,
          workType: "maintenance",
          instructions: "=1+1",
          notes: '- filter vervangen; toestel "lekt"',
        },
        {
          status: "completed",
          scheduledDate: "2032-03-02",
          workedMinutes: 120,
          correctedMinutes: 90,
          workType: "repair",
        },
        { status: "invoiced", scheduledDate: "2032-03-03", workedMinutes: 60 },
        { status: "cancelled", scheduledDate: "2032-03-04" },
        { status: "completed", scheduledDate: "2032-03-05", workedMinutes: 30 },
      ],
    );
    for (const number of [plain, corrected, invoiced]) {
      await setTaskCompletedAt(number, at(day, "10:00:00"));
    }
    // Completed on the next day: outside the period.
    await setTaskCompletedAt(other, at(addDays(day, 1), "10:00:00"));

    await signInAsBackoffice(page);
    await openExportPage(page, `?from=${day}&to=${day}`);

    await test.step("the form has the design's fields and the default scope", async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Exporteren voor de facturatie",
      );
      await expect(page.getByLabel("Van", { exact: true })).toHaveValue(day);
      await expect(page.getByLabel("Tot en met")).toHaveValue(day);
      await expect(page.getByRole("radio", { name: /Enkel nog te factureren/ })).toBeChecked();
    });

    await test.step("the default scope exports Afgewerkt only", async () => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download" }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`taken-${day}-tot-${day}.csv`);
      const buffer = await readFile((await download.path())!);
      // UTF-8 with a byte order mark.
      expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = buffer.toString("utf8").slice(1).split("\r\n");
      expect(lines[0]).toBe(
        "Taaknummer;Datum;Klant;Adres;Technieker;Soort werk;Omschrijving;Gewerkte uren;Notities;Status",
      );
      // Header, two tasks, and the empty piece after the last line break.
      expect(lines).toHaveLength(4);
      expect(lines[1]).toBe(
        `${plain};${shown(day)};${token} Bakkerij;Teststraat 1, 9000 Gent;${technician.fullName};Onderhoud;'=1+1;1,25;"'- filter vervangen; toestel ""lekt""";Afgewerkt`,
      );
      expect(lines[2]).toBe(
        // 2u00 by the technician, corrected to 1u30: the corrected hours count. No notes.
        `${corrected};${shown(day)};${token} Bakkerij;Teststraat 1, 9000 Gent;${technician.fullName};Herstelling;E2E-taak;1,5;;Afgewerkt`,
      );
      const numbers = lines.map((line) => line.split(";")[0]);
      for (const left of [invoiced, cancelled, other]) {
        expect(numbers).not.toContain(String(left));
      }

      await expect(page.getByRole("status")).toContainText(
        `Het bestand met 2 taken is gedownload (taken-${day}-tot-${day}.csv). Markeer de taken als gefactureerd zodra je ze gefactureerd hebt.`,
      );
      await expect(page.getByRole("link", { name: "Naar de afgewerkte taken" })).toHaveAttribute(
        "href",
        `/tasks?status=completed&from=${day}&to=${day}`,
      );
    });

    await test.step("the link shows exactly the tasks of the file, also tasks planned earlier than the period", async () => {
      // Both tasks of the file were planned on 1 and 2 March 2032, before the day of completing.
      await page.getByRole("link", { name: "Naar de afgewerkte taken" }).click();
      await expect(page).toHaveURL(`/tasks?status=completed&from=${day}&to=${day}`);
      const link = (number: number) =>
        page.getByRole("link", { name: new RegExp(`#${number}(?!\\d)`) });
      await expect(link(plain).first()).toBeVisible();
      await expect(link(corrected).first()).toBeVisible();
      await expect(link(other)).toHaveCount(0);
      await expect(link(invoiced)).toHaveCount(0);
      await page.goBack();
      await page.locator('form[data-hydrated="true"]').waitFor();
    });

    await test.step("'Afgewerkt en gefactureerd' adds the invoiced task", async () => {
      await page.getByRole("radio", { name: /Afgewerkt en gefactureerd/ }).check();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download" }).click(),
      ]);
      const text = (await readFile((await download.path())!)).toString("utf8");
      expect(text).toContain(`${invoiced};${shown(day)};`);
      expect(text).toContain(";Gefactureerd\r\n");
      expect(text.split("\r\n")).toHaveLength(5);
      await expect(page.getByRole("status")).toContainText("Het bestand met 3 taken is gedownload");
    });
  });

  test("tells that there is nothing to export for a period without tasks", async ({ page }) => {
    await signInAsBackoffice(page);
    await openExportPage(page);
    await page.getByLabel("Van", { exact: true }).fill("2032-02-01");
    await page.getByLabel("Tot en met").fill("2032-02-01");
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page).toHaveURL(/\/tasks\/export\?.*problem=empty/);
    await expect(page.getByRole("alert")).toContainText(
      "Er zijn geen afgewerkte taken tussen 01/02/2032 en 01/02/2032. Er is niets te exporteren.",
    );
    await expect(page.getByText("Kies een andere periode.")).toBeVisible();
    // The form keeps the days.
    await expect(page.getByLabel("Van", { exact: true })).toHaveValue("2032-02-01");
  });

  test("starts with the previous month and refuses a missing or reversed period", async ({
    page,
  }) => {
    await signInAsBackoffice(page);
    await openExportPage(page);
    const from = await page.getByLabel("Van", { exact: true }).inputValue();
    const to = await page.getByLabel("Tot en met").inputValue();
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to >= from).toBe(true);

    await page.getByLabel("Van", { exact: true }).fill("");
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page.getByRole("alert")).toHaveText("Kies een begin- en einddatum.");

    await page.getByLabel("Van", { exact: true }).fill("2032-03-20");
    await page.getByLabel("Tot en met").fill("2032-03-10");
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page.getByRole("alert")).toHaveText("De einddatum ligt vóór de begindatum.");
    await expect(page.getByLabel("Tot en met")).toHaveAttribute("aria-invalid", "true");
  });

  test("refuses a period of more than a year", async ({ page }) => {
    await signInAsBackoffice(page);
    await openExportPage(page);
    await page.getByLabel("Van", { exact: true }).fill("2031-01-01");
    await page.getByLabel("Tot en met").fill("2032-01-02");
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "De periode is te lang. Kies hoogstens 1 jaar (366 dagen).",
    );
    await expect(page.getByLabel("Tot en met")).toHaveAttribute("aria-invalid", "true");
  });

  test("shows no complaint at a first visit", async ({ page }) => {
    await signInAsBackoffice(page);
    await openExportPage(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Tot en met")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("is reachable from the button in the task overview, and back", async ({
    page,
    technician,
    token,
  }) => {
    // The button is only shown when there are tasks: make one of our own.
    const customerId = await createCustomer(`${token} Bakkerij`, BACKOFFICE.email, {
      street: "Gasthuisstraat 23",
      postalCode: "2300",
      city: "Turnhout",
    });
    await createTasksWithStatus(technician.email, BACKOFFICE.email, customerId, [
      { status: "assigned", scheduledDate: "2032-03-05" },
    ]);
    await signInAsBackoffice(page);
    await page.getByRole("link", { name: "Exporteren" }).click();
    await expect(page).toHaveURL("/tasks/export");
    await page.getByRole("link", { name: "← Taken" }).click();
    await expect(page).toHaveURL("/tasks");
  });

  test("is closed to a technician: no page and no file", async ({ page, technician }) => {
    await signIn(page, technician);
    await expect(page).toHaveURL("/my-tasks");
    await page.goto("/tasks/export");
    await expect(page.getByText("Deze pagina is niet voor jou bedoeld")).toBeVisible();
    const response = await page.request.get(
      "/tasks/export/download?from=2032-03-01&to=2032-03-31&scope=all",
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(403);
    expect(response.headers()["content-type"]).not.toContain("text/csv");
  });

  test("does not give a file to a visitor who is not signed in", async ({ request }) => {
    const response = await request.get(
      "/tasks/export/download?from=2032-03-01&to=2032-03-31&scope=all",
      { maxRedirects: 0 },
    );
    // The proxy sends visitors without a session to the login page, or the route says 401.
    expect([307, 308, 401]).toContain(response.status());
    expect(response.headers()["content-type"] ?? "").not.toContain("text/csv");
  });
});
