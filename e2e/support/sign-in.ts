import type { Page } from "@playwright/test";

import { TEST_PASSWORD, type TestUser } from "./test-users";

/**
 * Opens the login page and waits until React has hydrated the form (the form sets
 * `data-hydrated`). A submit before that is a plain form post that React then replays, which
 * makes the result unpredictable.
 */
export async function openLoginPage(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator('form[data-hydrated="true"]').waitFor();
}

/** Fills in and submits the login form. Does not wait for the result. */
export async function signIn(
  page: Page,
  user: Pick<TestUser, "email">,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await openLoginPage(page);
  await page.getByLabel("E-mailadres").fill(user.email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Aanmelden" }).click();
}
