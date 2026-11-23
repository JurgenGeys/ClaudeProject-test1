import { expect, test } from "@playwright/test";

test("home page opens and shows the project title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Elmija – testproject");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Elmija – testproject");
});
