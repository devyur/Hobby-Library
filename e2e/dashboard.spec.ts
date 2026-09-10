import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #27 (Dashboard statistics, folding in #43's
// completion-trend charts): the real Dashboard page (getDashboardData,
// lib/queries/dashboard.ts + LibraryStats.tsx + CompletionTrends.tsx)
// against the live project. What only a live browser + real project can
// prove is covered here rather than lib/queries/dashboard.test.ts's mocked
// unit coverage: the page actually renders every stat's real empty state
// for a brand-new account with no crash, and a seeded-via-admin-API
// scenario with real `completed_at` values proves the Completion trends
// chart's zero-fill logic. (completed_at is also now settable through the
// real edit form -- issue #34 -- see e2e/completed-date.spec.ts for that
// UI-driven path; this file keeps direct-insert seeding so the zero-fill
// math above stays independent of the edit form itself.)
//
// Test accounts are created via the Supabase Admin API (auth.admin.createUser)
// rather than the public /register flow, same as e2e/trash.spec.ts, to
// avoid adding to that endpoint's signup rate limit. Every account created
// here is deleted in a `finally` block.

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
    completedAt?: string | null;
    categorySlug?: string;
    subtypeName?: string;
  },
) {
  const { category, subtype } = await categoryAndSubtype(
    user,
    fields.categorySlug ?? "games",
    fields.subtypeName ?? "RPG",
  );

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
      completed_at: fields.completedAt ?? null,
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${fields.title} failed`);

  return { itemId: item.id as string };
}

test.describe("Dashboard statistics (issue #27)", () => {
  test("a brand-new account renders every stat's empty state cleanly: all-zero tiles, no-ratings/no-rate placeholders, empty recently-added and category breakdown, and every category's completion trend shows its empty state", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "dash-empty");
      userId = id;

      await loginViaUI(page, email);
      const main = page.locator("main");

      await expect(main).not.toContainText("Dashboard stats coming in #27");

      // Your library totals: Total + all four statuses, all zero.
      await expect(main.locator('[aria-label="Total: 0"]')).toBeVisible();
      await expect(main.locator('[aria-label="Planned: 0"]')).toBeVisible();
      await expect(main.locator('[aria-label="Ongoing: 0"]')).toBeVisible();
      await expect(main.locator('[aria-label="Completed: 0"]')).toBeVisible();
      await expect(main.locator('[aria-label="Dropped: 0"]')).toBeVisible();

      // Average rating / completion rate empty states -- never NaN/0/0%.
      await expect(main.locator('[aria-label="Average rating: No ratings yet"]')).toBeVisible();
      await expect(main.locator('[aria-label="Completion rate: —"]')).toBeVisible();

      // Rating distribution: all 10 buckets present and zero.
      for (let rating = 1; rating <= 10; rating++) {
        await expect(main.locator(`[aria-label="Rating ${rating}: 0"]`)).toBeVisible();
      }

      // Recently added / category breakdown empty states.
      await expect(main.locator('[aria-label="Recently added"]').getByText("No items yet.")).toBeVisible();
      await expect(main.getByText("No items yet.")).toHaveCount(2); // recently added + category breakdown

      // Every one of the four seeded V1 categories renders its own
      // Completion trends panel, and every one shows the empty state --
      // completed_at is all-NULL for a brand-new account with nothing
      // completed yet.
      for (const categoryName of ["Games", "Books", "Audio", "Video"]) {
        const panel = main.locator(`[aria-label="${categoryName} completion trend"]`);
        await expect(panel).toBeVisible();
        await expect(panel.getByText(/no completion dates recorded yet/i)).toBeVisible();
      }
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("with real data (ratings across statuses, and completed_at seeded directly since the app itself can't set it yet), every stat computes correctly and the per-category trend chart is zero-filled across the gap between completion months", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "dash-seeded");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const now = Date.now();
      const minutesAgo = (n: number) => new Date(now - n * 60_000).toISOString();

      // Games: 1 planned (unrated), 1 ongoing (rated 5), 2 completed in Jan
      // 2025 (rated 8 each), 1 completed in Aug 2025 (rated 10) -- a real
      // gap between Jan and Aug that must render as zero-filled, not
      // skipped -- and 1 dropped (rated 3). created_at staggered so
      // Recently added has a deterministic order.
      await insertItem(user, userId, {
        title: "Game Planned",
        status: "planned",
        rating: null,
        createdAt: minutesAgo(6),
      });
      await insertItem(user, userId, {
        title: "Game Ongoing",
        status: "ongoing",
        rating: 5,
        createdAt: minutesAgo(5),
      });
      await insertItem(user, userId, {
        title: "Game Completed A",
        status: "completed",
        rating: 8,
        createdAt: minutesAgo(4),
        completedAt: "2025-01-10T00:00:00.000Z",
      });
      await insertItem(user, userId, {
        title: "Game Completed B",
        status: "completed",
        rating: 8,
        createdAt: minutesAgo(3),
        completedAt: "2025-01-20T00:00:00.000Z",
      });
      await insertItem(user, userId, {
        title: "Game Completed C",
        status: "completed",
        rating: 10,
        createdAt: minutesAgo(2),
        completedAt: "2025-08-05T00:00:00.000Z",
      });
      await insertItem(user, userId, {
        title: "Game Dropped",
        status: "dropped",
        rating: 3,
        createdAt: minutesAgo(1),
      });

      // Books: 1 completed, rated 7, completed in March 2025 -- a single-
      // month trend (no zero-fill needed, since start === end).
      await insertItem(user, userId, {
        title: "Book Completed",
        status: "completed",
        rating: 7,
        createdAt: minutesAgo(0),
        completedAt: "2025-03-12T00:00:00.000Z",
        categorySlug: "books",
        subtypeName: "Fiction",
      });

      await loginViaUI(page, email);
      const main = page.locator("main");

      // -- Your library totals --
      await expect(main.locator('[aria-label="Total: 7"]')).toBeVisible();
      await expect(main.locator('[aria-label="Planned: 1"]')).toBeVisible();
      await expect(main.locator('[aria-label="Ongoing: 1"]')).toBeVisible();
      await expect(main.locator('[aria-label="Completed: 4"]')).toBeVisible();
      await expect(main.locator('[aria-label="Dropped: 1"]')).toBeVisible();

      // -- Average rating: (5+8+8+10+3+7)/6 = 41/6 = 6.8333... -> 6.8 --
      await expect(main.locator('[aria-label="Average rating: 6.8"]')).toBeVisible();

      // -- Completion rate: 4 completed / (4 completed + 1 dropped) = 80% --
      await expect(main.locator('[aria-label="Completion rate: 80%"]')).toBeVisible();

      // -- Rating distribution: exact per-bucket counts, including untouched zero buckets --
      await expect(main.locator('[aria-label="Rating 3: 1"]')).toBeVisible();
      await expect(main.locator('[aria-label="Rating 5: 1"]')).toBeVisible();
      await expect(main.locator('[aria-label="Rating 7: 1"]')).toBeVisible();
      await expect(main.locator('[aria-label="Rating 8: 2"]')).toBeVisible();
      await expect(main.locator('[aria-label="Rating 10: 1"]')).toBeVisible();
      for (const rating of [1, 2, 4, 6, 9]) {
        await expect(main.locator(`[aria-label="Rating ${rating}: 0"]`)).toBeVisible();
      }

      // -- Category breakdown: Games (6) before Books (1), sorted by count desc --
      await expect(main.locator('[aria-label="Games: 6 items"]')).toBeVisible();
      await expect(main.locator('[aria-label="Books: 1 items"]')).toBeVisible();

      // -- Recently added: 5 most recent by created_at desc (Game Planned
      // and Game Ongoing -- the 2 oldest -- excluded). --
      const recentSection = main.locator('[aria-label="Recently added"]');
      const recentLinks = recentSection.getByRole("link");
      await expect(recentLinks).toHaveCount(5);
      await expect(recentLinks.nth(0)).toHaveText("Book Completed");
      await expect(recentLinks.nth(1)).toHaveText("Game Dropped");
      await expect(recentLinks.nth(2)).toHaveText("Game Completed C");
      await expect(recentLinks.nth(3)).toHaveText("Game Completed B");
      await expect(recentLinks.nth(4)).toHaveText("Game Completed A");

      // -- Completion trends: Games is zero-filled across the Jan-Aug 2025
      // gap (2 in Jan, 0 for Feb-Jul, 1 in Aug); Books is a single month. --
      const gamesPanel = main.locator('[aria-label="Games completion trend"]');
      await expect(gamesPanel).toBeVisible();
      await expect(gamesPanel.locator('[title="Jan 2025: 2"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="Feb 2025: 0"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="Mar 2025: 0"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="Apr 2025: 0"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="May 2025: 0"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="Jun 2025: 0"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="Jul 2025: 0"]')).toHaveCount(1);
      await expect(gamesPanel.locator('[title="Aug 2025: 1"]')).toHaveCount(1);
      // Exactly 8 monthly bars -- no extra/missing months.
      await expect(gamesPanel.locator("[title]")).toHaveCount(8);

      const booksPanel = main.locator('[aria-label="Books completion trend"]');
      await expect(booksPanel).toBeVisible();
      await expect(booksPanel.locator('[title="Mar 2025: 1"]')).toHaveCount(1);
      await expect(booksPanel.locator("[title]")).toHaveCount(1);

      // Audio/Video: this account has zero items in either -- still get
      // their own empty-state panel (one per seeded V1 category, always).
      for (const categoryName of ["Audio", "Video"]) {
        const panel = main.locator(`[aria-label="${categoryName} completion trend"]`);
        await expect(panel).toBeVisible();
        await expect(panel.getByText(/no completion dates recorded yet/i)).toBeVisible();
      }
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
