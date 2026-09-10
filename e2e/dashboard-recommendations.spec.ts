import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #28 (Dashboard recommendations): the real
// Recommendations block (getRecommendations, lib/queries/dashboard.ts +
// RecommendationsSection.tsx) against the live project, composed alongside
// #27's stats block on /dashboard. What only a live browser + real project
// can prove, beyond lib/queries/dashboard.test.ts's mocked unit coverage of
// the four query shapes: the whole-block vs. per-section empty states
// render correctly together on a real page, Completed/Dropped/trashed/
// another account's items never leak into any section, a Planned item can
// legitimately appear in more than one section, the 5-item cap holds against
// real data, and clicking a recommended item actually lands on the right
// `/{categorySlug}/{itemId}` (proving the categories join, not just that a
// slug string was returned).
//
// Test accounts are created via the Supabase Admin API (auth.admin.createUser),
// same as e2e/dashboard.spec.ts and e2e/trash.spec.ts, to avoid adding to the
// public /register flow's signup rate limit. Every account created here is
// deleted in a `finally` block.

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
    priority?: "low" | "medium" | "high" | null;
    createdAt: string;
    categorySlug?: string;
    subtypeName?: string;
    deletedAt?: string | null;
  },
) {
  const { category, subtype } = await categoryAndSubtype(
    user,
    fields.categorySlug ?? "games",
    fields.subtypeName ?? "RPG",
  );

  const { data: item, error } = await user
    .from("items")
    .insert({
      user_id: userId,
      category_id: category.id,
      subtype_id: subtype.id,
      title: fields.title,
      status: fields.status,
      rating: fields.rating ?? null,
      priority: fields.priority ?? null,
      created_at: fields.createdAt,
      deleted_at: fields.deletedAt ?? null,
    })
    .select("id")
    .single();
  if (error || !item) throw error ?? new Error(`insert ${fields.title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

test.describe("Dashboard recommendations (issue #28)", () => {
  test("a brand-new account (no items at all) collapses the Recommendations block to one shared empty message, no sub-section headings", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "rec-empty");
      userId = id;

      await loginViaUI(page, email);
      const main = page.locator("main");

      await expect(main.getByRole("heading", { name: "Recommendations" })).toBeVisible();
      await expect(
        main.getByText(/no recommendations yet/i),
      ).toBeVisible();

      // None of the four sub-section headings render when the whole block
      // collapses to the shared message.
      for (const heading of [
        "High-rated Planned",
        "High-priority Planned",
        "Random pick",
        "Continue",
      ]) {
        await expect(main.getByRole("heading", { name: heading })).toHaveCount(0);
      }
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("an account with only Completed/Dropped items still shows the shared empty message (Planned/Ongoing-only sections all empty)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "rec-completed-only");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const now = Date.now();
      await insertItem(user, userId, {
        title: "Finished Game",
        status: "completed",
        rating: 10,
        priority: "high",
        createdAt: new Date(now).toISOString(),
      });
      await insertItem(user, userId, {
        title: "Abandoned Game",
        status: "dropped",
        rating: 9,
        priority: "high",
        createdAt: new Date(now - 60_000).toISOString(),
      });

      await loginViaUI(page, email);
      const main = page.locator("main");
      // Scoped to the Recommendations block specifically -- #27's "Recently
      // added" stats panel legitimately shows Completed/Dropped items too,
      // so a plain `main.getByText(...)` check would false-positive there.
      const recommendationsBlock = main.locator("section", {
        has: page.getByRole("heading", { name: "Recommendations" }),
      });

      await expect(recommendationsBlock.getByText(/no recommendations yet/i)).toBeVisible();
      await expect(recommendationsBlock.getByText("Finished Game")).toHaveCount(0);
      await expect(recommendationsBlock.getByText("Abandoned Game")).toHaveCount(0);
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("each section computes its own correct picks with real data: exact rating/priority/status rules, cross-category links, the 5-item cap, overlap between sections, and Completed/Dropped/trashed/another account's items never appear anywhere", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let otherUserId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "rec-full");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const now = Date.now();
      const minutesAgo = (n: number) => new Date(now - n * 60_000).toISOString();

      // -- High-rated Planned: 6 Planned items rated >= 8 (one over the cap,
      // to prove LIMIT 5 holds against real data) -- staggered createdAt so
      // the oldest of the six is the one that must be excluded (rating desc,
      // created_at desc as the tie-breaker). --
      for (let i = 6; i >= 1; i--) {
        await insertItem(user, userId, {
          title: `High Rated ${i}`,
          status: "planned",
          rating: 8,
          createdAt: minutesAgo(i),
        });
      }
      // Not high-rated (rating below 8) -- must never appear in that section.
      await insertItem(user, userId, {
        title: "Mediocre Planned",
        status: "planned",
        rating: 5,
        createdAt: minutesAgo(20),
      });
      // Unrated Planned -- must never appear in High-rated (NULL never
      // matches a >= threshold).
      await insertItem(user, userId, {
        title: "Unrated Planned",
        status: "planned",
        rating: null,
        createdAt: minutesAgo(21),
      });

      // -- High-priority Planned: distinct item, and one item that's BOTH
      // high-rated AND high-priority -- proves sections are independent, no
      // de-duplication across them. --
      await insertItem(user, userId, {
        title: "High Priority Only",
        status: "planned",
        priority: "high",
        createdAt: minutesAgo(10),
        categorySlug: "books",
        subtypeName: "Fiction",
      });
      await insertItem(user, userId, {
        title: "Both High Rated And Priority",
        status: "planned",
        rating: 9,
        priority: "high",
        createdAt: minutesAgo(9),
      });
      // Low/medium priority Planned -- must never appear in that section.
      await insertItem(user, userId, {
        title: "Low Priority Planned",
        status: "planned",
        priority: "low",
        createdAt: minutesAgo(22),
      });

      // -- Continue (Ongoing) --
      await insertItem(user, userId, {
        title: "Currently Reading",
        status: "ongoing",
        createdAt: minutesAgo(2),
        categorySlug: "books",
        subtypeName: "Fiction",
      });
      await insertItem(user, userId, {
        title: "Currently Playing",
        status: "ongoing",
        createdAt: minutesAgo(1),
      });

      // -- Never appear anywhere: Completed, Dropped, soft-deleted (Trash) --
      await insertItem(user, userId, {
        title: "Finished And Rated Ten",
        status: "completed",
        rating: 10,
        priority: "high",
        createdAt: minutesAgo(3),
      });
      await insertItem(user, userId, {
        title: "Dropped High Priority",
        status: "dropped",
        priority: "high",
        createdAt: minutesAgo(4),
      });
      await insertItem(user, userId, {
        title: "Trashed High Rated Planned",
        status: "planned",
        rating: 10,
        createdAt: minutesAgo(5),
        deletedAt: new Date(now).toISOString(),
      });

      // -- Another account's item, also high-rated Planned -- must never
      // leak into this account's Recommendations (RLS + explicit user_id). --
      const { email: otherEmail, userId: otherId } = await createAdminUser(admin, "rec-other");
      otherUserId = otherId;
      const otherUser = await createSupabaseUserClient(otherEmail, TEST_PASSWORD);
      await insertItem(otherUser, otherId, {
        title: "Someone Elses High Rated Planned",
        status: "planned",
        rating: 10,
        createdAt: minutesAgo(0),
      });

      await loginViaUI(page, email);
      const main = page.locator("main");

      // -- High-rated Planned: 7 candidates qualify (rating >= 8) --
      // "Both High Rated And Priority" (rating 9) outranks all six rating-8
      // "High Rated N" items regardless of created_at, then the four most
      // recently created rating-8 items fill the rest of the 5-item cap:
      // rating desc puts the rating-9 item first, created_at desc breaks the
      // tie among the rating-8 items (1 is newest, 6 is oldest) -- so
      // "High Rated 5" and "High Rated 6" are the two pushed out by the cap.
      // Mediocre/Unrated Planned never qualify at all (rating < 8 / NULL). --
      const highRated = main.locator('[aria-label="High-rated Planned"]');
      await expect(highRated).toBeVisible();
      await expect(highRated.getByRole("link")).toHaveCount(5);
      await expect(
        highRated.getByText("Both High Rated And Priority", { exact: true }),
      ).toBeVisible();
      for (let i = 1; i <= 4; i++) {
        await expect(highRated.getByText(`High Rated ${i}`, { exact: true })).toBeVisible();
      }
      await expect(highRated.getByText("High Rated 5", { exact: true })).toHaveCount(0);
      await expect(highRated.getByText("High Rated 6", { exact: true })).toHaveCount(0);
      await expect(highRated.getByText("Mediocre Planned")).toHaveCount(0);
      await expect(highRated.getByText("Unrated Planned")).toHaveCount(0);

      // -- High-priority Planned: both high-priority items, low-priority
      // excluded. "Both High Rated And Priority" appearing here too (it's
      // already asserted visible in highRated above) is the overlap case --
      // a Planned item legitimately shows in more than one section, no
      // cross-section de-duplication. --
      const highPriority = main.locator('[aria-label="High-priority Planned"]');
      await expect(highPriority).toBeVisible();
      await expect(highPriority.getByText("High Priority Only", { exact: true })).toBeVisible();
      await expect(
        highPriority.getByText("Both High Rated And Priority", { exact: true }),
      ).toBeVisible();
      await expect(highPriority.getByText("Low Priority Planned")).toHaveCount(0);

      // -- Continue (Ongoing): both ongoing items, nothing Planned. --
      const continueSection = main.locator('[aria-label="Continue"]');
      await expect(continueSection).toBeVisible();
      await expect(continueSection.getByText("Currently Reading", { exact: true })).toBeVisible();
      await expect(continueSection.getByText("Currently Playing", { exact: true })).toBeVisible();
      await expect(continueSection.getByRole("link")).toHaveCount(2);

      // -- Random pick: exactly one card, and it's one of the account's real
      // Planned items (re-rolled fresh -- not asserting which one). --
      const randomSection = main.locator('[aria-label="Random pick"]');
      await expect(randomSection).toBeVisible();
      await expect(randomSection.getByRole("link")).toHaveCount(1);

      // -- Never appear anywhere in the whole Recommendations block: --
      const recommendationsBlock = main.locator("section", { has: page.getByRole("heading", { name: "Recommendations" }) });
      for (const title of [
        "Finished And Rated Ten",
        "Dropped High Priority",
        "Trashed High Rated Planned",
        "Someone Elses High Rated Planned",
      ]) {
        await expect(recommendationsBlock.getByText(title, { exact: true })).toHaveCount(0);
      }

      // -- Cross-category link correctness: "High Priority Only" is a Books
      // item -- clicking it must land on /books/{itemId}, not a hardcoded or
      // wrong category. --
      await highPriority.getByText("High Priority Only", { exact: true }).click();
      await page.waitForURL(/\/books\//);
      await expect(page.getByRole("heading", { name: "High Priority Only", level: 1 })).toBeVisible();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
      if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
    }
  });
});
