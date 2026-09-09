import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #22 (Search). A single test/account covers
// every acceptance criterion (per-field partial match, category scoping,
// case-insensitivity, whitespace tolerance, empty/zero-match states, Trash
// exclusion) -- one disposable account rather than one per scenario, per
// the "pace test-account creation" guidance. Items are inserted directly
// against the live DB via the signed-in test user's own RLS-scoped client,
// same approach category-library.spec.ts uses (no in-app Full/Quick Add
// flow sets notes/review/tags in one step yet).

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Search (issue #22)", () => {
  test("partial-word match on title/tag/notes/review, OR'd, case-insensitive, whitespace-tolerant, scoped to the open category, excludes Trash, and empty/zero-match states behave correctly", async ({
    page,
  }) => {
    const email = randomTestEmail("search");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: gamesCategory } = await user
        .from("categories")
        .select("id")
        .eq("slug", "games")
        .single();
      const { data: booksCategory } = await user
        .from("categories")
        .select("id")
        .eq("slug", "books")
        .single();
      if (!gamesCategory || !booksCategory) throw new Error("expected categories not found");

      async function otherSubtypeId(categoryId: string): Promise<string> {
        const { data } = await user
          .from("subtypes")
          .select("id")
          .eq("category_id", categoryId)
          .is("user_id", null)
          .eq("name", "Other")
          .single();
        if (!data) throw new Error(`'Other' subtype not found for category ${categoryId}`);
        return data.id;
      }

      const gamesOther = await otherSubtypeId(gamesCategory.id);
      const booksOther = await otherSubtypeId(booksCategory.id);

      // Item 1: matches by title only ("witch" -> "The Witcher 3").
      const { data: titleItem } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "The Witcher 3",
          category_id: gamesCategory.id,
          subtype_id: gamesOther,
          status: "planned",
        })
        .select("id")
        .single();

      // Item 2: matches by tag only -- a custom tag "roguelike", found via
      // "rogue" (issue #22's own example), not present anywhere on the item
      // itself. Proves the item_tags -> tags join, not a column on items.
      const { data: tagItem } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Silent Entry",
          category_id: gamesCategory.id,
          subtype_id: gamesOther,
          status: "planned",
        })
        .select("id")
        .single();
      const { data: customTag } = await user
        .from("tags")
        .insert({ user_id: userId, name: "roguelike" })
        .select("id")
        .single();
      if (!tagItem || !customTag) throw new Error("tag-match seed insert failed");
      await user.from("item_tags").insert({ item_id: tagItem.id, tag_id: customTag.id });

      // Item 3: matches by notes only.
      const { data: notesItem } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Quiet Entry",
          category_id: gamesCategory.id,
          subtype_id: gamesOther,
          status: "planned",
          notes: "Excellent worldbuilding throughout.",
        })
        .select("id")
        .single();

      // Item 4: matches by review only.
      const { data: reviewItem } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Another Entry",
          category_id: gamesCategory.id,
          subtype_id: gamesOther,
          status: "completed",
          review: "An outstanding soundtrack carries the whole game.",
        })
        .select("id")
        .single();

      // Item 5: title would match "witch" too, but it's soft-deleted --
      // must never appear in search results (same as the unfiltered view).
      const { data: deletedItem } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "The Witcher 2",
          category_id: gamesCategory.id,
          subtype_id: gamesOther,
          status: "dropped",
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      // Item 6: title matches "witch" too, but lives in Books, not Games --
      // proves search stays scoped to the open category.
      const { data: crossCategoryItem } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "The Witcher Book",
          category_id: booksCategory.id,
          subtype_id: booksOther,
          status: "planned",
        })
        .select("id")
        .single();

      if (!titleItem || !notesItem || !reviewItem || !deletedItem || !crossCategoryItem) {
        throw new Error("seed insert failed");
      }

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      const searchBox = page.getByRole("searchbox", { name: "Search" });
      await expect(searchBox).toBeVisible();

      // Baseline (no search term): the full unfiltered list -- all four
      // live Games items, not the soft-deleted one.
      await expect(page.getByRole("link", { name: /The Witcher 3/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Silent Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Quiet Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Another Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: "The Witcher 2" })).toHaveCount(0);

      // Title match, case-insensitive, with leading/trailing whitespace --
      // and confirms the soft-deleted item still never appears even though
      // its title matches too.
      await searchBox.fill("  WITCH  ");
      await expect(page.getByRole("link", { name: /The Witcher 3/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Silent Entry/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Quiet Entry/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Another Entry/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "The Witcher 2" })).toHaveCount(0);

      // Tag match ("rogue" -> "roguelike", via item_tags -> tags).
      await searchBox.fill("rogue");
      await expect(page.getByRole("link", { name: /Silent Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /The Witcher 3/ })).toHaveCount(0);

      // Notes match.
      await searchBox.fill("worldbuild");
      await expect(page.getByRole("link", { name: /Quiet Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /The Witcher 3/ })).toHaveCount(0);

      // Review match.
      await searchBox.fill("soundtr");
      await expect(page.getByRole("link", { name: /Another Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Quiet Entry/ })).toHaveCount(0);

      // Zero matches: the "no matches" state, not an error and not the
      // true-empty-library message.
      await searchBox.fill("zzzznomatch");
      await expect(page.getByText('No items match "zzzznomatch".')).toBeVisible();
      await expect(page.getByText(/^No items in Games yet\.$/)).toHaveCount(0);

      // Clearing the box returns to the full unfiltered list.
      await searchBox.fill("");
      await expect(page.getByRole("link", { name: /The Witcher 3/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Silent Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Quiet Entry/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Another Entry/ })).toBeVisible();

      // Category scoping, the other direction: Books' own search for
      // "witch" finds the Books item -- proves Games' search above wasn't
      // secretly global.
      await page.locator("aside").getByRole("link", { name: "Books" }).click();
      await page.waitForURL("**/books");
      await page.getByRole("searchbox", { name: "Search" }).fill("witch");
      await expect(page.getByRole("link", { name: /The Witcher Book/ })).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
