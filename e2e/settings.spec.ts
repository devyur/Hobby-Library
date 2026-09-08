import { expect, test } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #11 (Settings page): the signed-in account's
// email + a working sign-out control + the theme toggle now live on
// /settings (moved off Dashboard, which becomes a minimal placeholder), and
// the toggle still persists via user_preferences the same way it did when
// temporarily mounted in layout.tsx (#8). Each test registers its own
// disposable account via the real UI and deletes it afterward, same
// convention as e2e/nav.spec.ts.

async function registerViaUI(page: import("@playwright/test").Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Settings page (issue #11)", () => {
  test("shows the signed-in account's email, logs out from Settings, and Dashboard no longer shows email/Log out", async ({
    page,
  }) => {
    const email = randomTestEmail("settings-basic");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      // AC: Dashboard is now a minimal placeholder -- no email, no Log out.
      await expect(
        page.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(email)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /log out/i }),
      ).toHaveCount(0);

      await page.locator("aside").getByRole("link", { name: "Settings" }).click();
      await page.waitForURL("**/settings");

      // AC: Settings shows the signed-in account's email.
      await expect(page.getByText(email)).toBeVisible();

      // AC: "Log out" works from its new location on Settings.
      await page
        .getByRole("button", { name: /log out/i })
        .click();
      await page.waitForURL("**/login");
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("theme toggle on Settings flips the theme and persists it via user_preferences", async ({
    page,
  }) => {
    const email = randomTestEmail("settings-theme");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      await page.locator("aside").getByRole("link", { name: "Settings" }).click();
      await page.waitForURL("**/settings");

      const toggle = page.getByRole("button", { name: /toggle theme/i });
      await expect(toggle).toBeVisible();

      const before = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );
      const expected = before === "dark" ? "light" : "dark";

      await toggle.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", expected);

      const userClient = await createSupabaseUserClient(email, TEST_PASSWORD);
      await expect
        .poll(
          async () => {
            const { data } = await userClient
              .from("user_preferences")
              .select("theme")
              .maybeSingle();
            return data?.theme ?? null;
          },
          { timeout: 5000 },
        )
        .toBe(expected);
      await userClient.auth.signOut();
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
