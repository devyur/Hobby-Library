import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #50 (per-category Dashboard drill-down):
// the real /dashboard/[category] route (getCategoryDashboardStats,
// lib/queries/dashboard.ts + LibraryStats.tsx's showCategoryBreakdown={false}
// reuse) against the live project, plus the account-wide Dashboard's new
// clickable "Category breakdown" rows that link there. Mocked/unit-level
// stat computation is already covered exhaustively by
// lib/queries/dashboard.test.ts; this file proves the live routing,
// filtering, and the "these components must NOT appear here" negatives that
// only a real render can prove.

async function createAdminUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string,
): Promise<{ email: string; userId: string }> {
  const email = randomTestEmail(label);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`createUser(${label}) failed`);
  return { email, userId: data.user.id };
}

async function loginViaUI(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL("**/dashboard");
}

async function categoryAndSubtype(
  user: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  categorySlug: string,
  subtypeName: string,
) {
  const { data: category } = await user
    .from("categories")
    .select("id, slug, name")
    .eq("slug", categorySlug)
    .single();
  if (!category) throw new Error(`${categorySlug} category not found`);

  const { data: subtype } = await user
    .from("subtypes")
    .select("id, name")
    .eq("category_id", category.id)
    .eq("name", subtypeName)
    .single();
  if (!subtype) throw new Error(`${subtypeName} subtype not found`);

  return { category, subtype };
}

async function insertItem(
  user: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  userId: string,
  fields: {
    title: string;
    status: "planned" | "ongoing" | "completed" | "dropped";
    rating?: number | null;
    createdAt: string;
    categorySlug: string;
    subtypeName: string;
  },
) {
  const { category, subtype } = await categoryAndSubtype(user, fields.categorySlug, fields.subtypeName);

  const { data: item } = await user
    .from("items")
    .insert({
      user_id: userId,
      category_id: category.id,
      subtype_id: subtype.id,
      title: fields.title,
      status: fields.status,
      rating: fields.rating ?? null,
      created_at: fields.createdAt,
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${fields.title} failed`);

  return { itemId: item.id as string };
}

test.describe("Per-category Dashboard drill-down (issue #50)", () => {
  test("clicking a Category breakdown row navigates to /dashboard/[slug], showing only that category's stats, with no Completion trends/Recommendations, and a working link back to the browse view -- while the account-wide Dashboard stays unchanged", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "dash-cat");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const now = Date.now();
      const minutesAgo = (n: number) => new Date(now - n * 60_000).toISOString();

      // Games: 2 completed (rated 8, 10), 1 planned (unrated).
      await insertItem(user, userId, {
        title: "Game Completed A",
        status: "completed",
        rating: 8,
        createdAt: minutesAgo(3),
        categorySlug: "games",
        subtypeName: "RPG",
      });
      await insertItem(user, userId, {
        title: "Game Completed B",
        status: "completed",
        rating: 10,
        createdAt: minutesAgo(2),
        categorySlug: "games",
        subtypeName: "RPG",
      });
      await insertItem(user, userId, {
        title: "Game Planned",
        status: "planned",
        rating: null,
        createdAt: minutesAgo(1),
        categorySlug: "games",
        subtypeName: "RPG",
      });

      // Books: 1 dropped (rated 3) -- must not leak into Games' scoped stats.
      await insertItem(user, userId, {
        title: "Book Dropped",
        status: "dropped",
        rating: 3,
        createdAt: minutesAgo(0),
        categorySlug: "books",
        subtypeName: "Fiction",
      });

      await loginViaUI(page, email);
      const main = page.locator("main");

      // -- Account-wide Dashboard: Category breakdown row for Games is a
      // real link (not JS-only), and clicking it navigates to the new
      // per-category route. --
      const gamesRow = main.locator('[aria-label="Games: 3 items"]');
      await expect(gamesRow).toBeVisible();
      const gamesLink = gamesRow.getByRole("link");
      await expect(gamesLink).toHaveAttribute("href", "/dashboard/games");

      await gamesLink.click();
      await page.waitForURL("**/dashboard/games");

      // -- Scoped page: heading, back link, browse link. --
      await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "← Dashboard" })).toHaveAttribute(
        "href",
        "/dashboard",
      );
      const browseLink = page.getByRole("link", { name: /view all games/i });
      await expect(browseLink).toHaveAttribute("href", "/games");

      // -- Stats are scoped to Games only: Total 3 (not 4 -- excludes the
      // Books item), Completed 2, Planned 1, average rating (8+10)/2 = 9,
      // completion rate 2 completed / (2 completed + 0 dropped) = 100%. --
      const scoped = page.locator("main");
      await expect(scoped.locator('[aria-label="Total: 3"]')).toBeVisible();
      await expect(scoped.locator('[aria-label="Planned: 1"]')).toBeVisible();
      await expect(scoped.locator('[aria-label="Ongoing: 0"]')).toBeVisible();
      await expect(scoped.locator('[aria-label="Completed: 2"]')).toBeVisible();
      await expect(scoped.locator('[aria-label="Dropped: 0"]')).toBeVisible();
      await expect(scoped.locator('[aria-label="Average rating: 9.0"]')).toBeVisible();
      await expect(scoped.locator('[aria-label="Completion rate: 100%"]')).toBeVisible();

      // Recently added: only the 3 Games items, not the Books one.
      const recentSection = scoped.locator('[aria-label="Recently added"]');
      const recentLinks = recentSection.getByRole("link");
      await expect(recentLinks).toHaveCount(3);
      await expect(recentLinks.nth(0)).toHaveText("Game Planned");

      // -- No "Category breakdown" section at all (showCategoryBreakdown=false). --
      await expect(scoped.getByText("Category breakdown")).toHaveCount(0);
      // Still shows Rating distribution.
      await expect(scoped.getByText("Rating distribution")).toBeVisible();

      // -- No Completion trends / Recommendations on this route in any form. --
      await expect(scoped.getByText(/completion trend/i)).toHaveCount(0);
      await expect(scoped.getByText(/recommended/i)).toHaveCount(0);
      await expect(scoped.getByText(/continue/i)).toHaveCount(0);

      // -- Browse link actually navigates to the existing /[slug] list view. --
      await browseLink.click();
      await page.waitForURL((url) => url.pathname === "/games");
      await expect(page).not.toHaveURL(/\/dashboard/);

      // -- Back to the account-wide Dashboard: unchanged, still shows
      // Category breakdown, Completion trends, Recommendations. --
      await page.goto("/dashboard");
      await expect(main.getByText("Category breakdown")).toBeVisible();
      await expect(main.locator('[aria-label="Total: 4"]')).toBeVisible();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("an unknown category slug at /dashboard/[category] renders the not-found page", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "dash-cat-404");
      userId = id;

      await loginViaUI(page, email);
      const response = await page.goto("/dashboard/not-a-real-category");
      expect(response?.status()).toBe(404);
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a category with zero items renders the same empty-state values as the account-wide Dashboard's zero-state", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "dash-cat-empty");
      userId = id;

      await loginViaUI(page, email);
      await page.goto("/dashboard/games");

      const main = page.locator("main");
      await expect(main.locator('[aria-label="Total: 0"]')).toBeVisible();
      await expect(main.locator('[aria-label="Planned: 0"]')).toBeVisible();
      await expect(main.locator('[aria-label="Average rating: No ratings yet"]')).toBeVisible();
      await expect(main.locator('[aria-label="Completion rate: —"]')).toBeVisible();
      for (let rating = 1; rating <= 10; rating++) {
        await expect(main.locator(`[aria-label="Rating ${rating}: 0"]`)).toBeVisible();
      }
      await expect(main.locator('[aria-label="Recently added"]').getByText("No items yet.")).toBeVisible();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
