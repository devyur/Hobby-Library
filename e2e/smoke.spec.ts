import { expect, test } from "@playwright/test";

// Proves the Playwright setup itself works end-to-end against a real
// browser + the dev server, independent of any feature under test.
test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
