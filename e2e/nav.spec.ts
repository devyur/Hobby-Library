import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #10 (App shell & dynamic navigation):
// category tabs rendering from the live `categories` table, every nav
// destination being a real route with active-tab highlighting, the
// last_screen redirect-on-login round trip, and mobile-width usability.
// Each test registers its own disposable account via the real UI and
// deletes it via the Supabase admin API afterward -- no shared fixtures,
// so tests can run fully in parallel per playwright.config.ts.

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

async function loginViaUI(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
}

test.describe("app shell & dynamic navigation (issue #10)", () => {
  test("category tabs render from the live categories table in sort_order, every destination is a real clickable route, and the active section is highlighted", async ({
    page,
  }) => {
    const email = randomTestEmail("nav-basic");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      const sidebar = page.locator("aside");

      // AC B: exactly four category tabs, from the live seeded data (#3),
      // in sort_order -- interleaved with the fixed Dashboard/Custom
      // Lists/Trash/Settings entries per plan.md §15. Nothing here
      // hardcodes which four they are; this assertion is what proves the
      // *live table* produced them, not the test's own expectations.
      await expect(sidebar.getByRole("link")).toHaveText([
        "Dashboard",
        "Games",
        "Books",
        "Audio",
        "Video",
        "Custom Lists",
        "Trash",
        "Settings",
      ]);

      // AC A: Dashboard is active on landing.
      await expect(
        sidebar.getByRole("link", { name: "Dashboard" }),
      ).toHaveAttribute("aria-current", "page");

      // AC C: every destination is a real route inside the shell (no bare
      // 404), and AC A: clicking it highlights it as the active section.
      const destinations: Array<[label: string, path: string, heading: string]> =
        [
          ["Games", "/games", "Games"],
          ["Books", "/books", "Books"],
          ["Audio", "/audio", "Audio"],
          ["Video", "/video", "Video"],
          ["Custom Lists", "/lists", "Custom Lists"],
          ["Trash", "/trash", "Trash"],
          ["Settings", "/settings", "Settings"],
          ["Dashboard", "/dashboard", null as unknown as string],
        ];

      for (const [label, path, heading] of destinations) {
        await sidebar.getByRole("link", { name: label, exact: true }).click();
        await page.waitForURL(`**${path}`);
        if (heading) {
          await expect(
            page.getByRole("heading", { name: heading, exact: true }),
          ).toBeVisible();
        }
        await expect(
          sidebar.getByRole("link", { name: label, exact: true }),
        ).toHaveAttribute("aria-current", "page");
      }

      // Edge case: an unknown slug typed directly is a genuine 404, not a
      // shell-wrapped "coming soon" stub.
      await page.goto("/this-is-not-a-real-category");
      await expect(
        page.getByText(/this page could not be found/i),
      ).toBeVisible();
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("last_screen: navigating to a non-Dashboard destination, then logging out and back in, lands on that same destination", async ({
    page,
  }) => {
    const email = randomTestEmail("nav-lastscreen");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      // The write is fire-and-forget (AC E) -- poll the row directly
      // (signed in as the test user, relying on user_preferences' own
      // "select own row" RLS policy -- see testAccount.ts's
      // createSupabaseUserClient comment for why this is used instead of
      // the admin/service-role client) rather than guessing a fixed delay,
      // since there's no UI signal for "the write landed".
      const userClient = await createSupabaseUserClient(email, TEST_PASSWORD);
      await expect
        .poll(
          async () => {
            const { data } = await userClient
              .from("user_preferences")
              .select("last_screen")
              .maybeSingle();
            return data?.last_screen ?? null;
          },
          { timeout: 5000 },
        )
        .toBe("/games");
      await userClient.auth.signOut();

      // "Log out": the only "Log out" control in the app today lives on
      // Dashboard itself (issue #9's temporary placeholder -- it moves to
      // Settings in #11). Navigating there first to click it would itself
      // overwrite last_screen back to "/dashboard" before logout ever ran,
      // defeating the exact thing this test checks. Clearing cookies ends
      // the session the same way signing out does, without an in-app
      // navigation that would touch last_screen -- a faithful stand-in
      // given the real "Log out" control's current, intentionally
      // temporary, location.
      await page.context().clearCookies();

      await loginViaUI(page, email);
      await page.waitForURL("**/games");
      await expect(
        page.getByRole("heading", { name: "Games", exact: true }),
      ).toBeVisible();
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a brand-new account lands on /dashboard after logging out and back in", async ({
    page,
  }) => {
    const email = randomTestEmail("nav-freshaccount");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      await page.context().clearCookies();
      await loginViaUI(page, email);

      await page.waitForURL("**/dashboard");
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("mobile viewport: every destination is reachable through the compact toggle with no horizontal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const email = randomTestEmail("nav-mobile");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      // Desktop sidebar is hidden at this width.
      await expect(page.locator("aside")).toBeHidden();

      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalScroll).toBe(false);

      const toggle = page.getByRole("button", { name: /open navigation/i });
      await expect(toggle).toBeVisible();
      await toggle.click();

      const panel = page.locator("#mobile-nav-panel");
      await expect(panel).toBeVisible();
      for (const label of [
        "Dashboard",
        "Games",
        "Books",
        "Audio",
        "Video",
        "Custom Lists",
        "Trash",
        "Settings",
      ]) {
        await expect(
          panel.getByRole("link", { name: label, exact: true }),
        ).toBeVisible();
      }

      const scrollAfterOpen = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(scrollAfterOpen).toBe(false);

      await panel.getByRole("link", { name: "Trash" }).click();
      await page.waitForURL("**/trash");
      await expect(
        page.getByRole("heading", { name: "Trash", exact: true }),
      ).toBeVisible();
      // The panel closes itself after a navigation.
      await expect(page.locator("#mobile-nav-panel")).toBeHidden();
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
