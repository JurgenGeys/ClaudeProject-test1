import { expect, test } from "@playwright/test";

test.describe("without a session", () => {
  test("the start page sends a visitor to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
    await expect(page).toHaveTitle("Aanmelden");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aanmelden bij de planning");
  });

  test("the login page shows the company name above the title", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByText(process.env.NEXT_PUBLIC_COMPANY_NAME!, { exact: true }),
    ).toBeVisible();
  });

  for (const path of ["/tasks", "/my-tasks"]) {
    test(`${path} sends a visitor to the login page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL("/login");
    });
  }
});
