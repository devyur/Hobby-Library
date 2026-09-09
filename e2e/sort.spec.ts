import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #24 (Sorting + remembered preference). One
// disposable account, one seeded set of items, and a single long test
// walking through each acceptance criterion in sequence -- same "one
// account, many assertions" shape as e2e/filters.spec.ts, rather than one
// account per scenario (see this file's own "pace test-account creation"
// guidance).
//
// Seeded items (category: Games, inserted in this order -- oldest first):
//   1. Alpha Item    -- planned,   priority low,    notes: "markerXYZ ..."
//   2. Bravo Item    -- ongoing,   priority high,   notes: "markerXYZ ..."
//   3. Charlie Item  -- completed, priority high
//   4. Delta Item    -- dropped,   priority medium, notes: "markerXYZ ..."
//   5. Echo Item     -- ongoing,   priority null
//   6. Foxtrot Item  -- planned,   priority null
//
// Expected orders (worked out by hand, see the issue's own acceptance
// criteria for the bucket order + created_at-desc tie-break rule):
//   Recently Added: Foxtrot, Echo, Delta, Charlie, Bravo, Alpha
//   Priority:        Charlie, Bravo, Delta, Alpha, Foxtrot, Echo
//     (high bucket ties Bravo/Charlie -> Charlie newer; no-priority bucket
//     ties Echo/Foxtrot -> Foxtrot newer)
//   Status:          Echo, Bravo, Foxtrot, Alpha, Charlie, Delta
//     (ongoing bucket ties Bravo/Echo -> Echo newer; planned bucket ties
//     Alpha/Foxtrot -> Foxtrot newer)
//   "markerXYZ" search subset (Alpha/Bravo/Delta) under Priority sort:
//     Bravo (high), Delta (medium), Alpha (low)

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Sorting + remembered preference (issue #24)", () => {
  test("Sort control offers Recently Added/Priority/Status, each produces the exact bucket order + created_at-desc tie-break, composes with search/filters without clearing them, persists across reload, and is shared (not reset) across categories", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = randomTestEmail("sort");
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
      if (!gamesCategory) throw new Error("games category not found");

      const { data: otherSubtype } = await user
        .from("subtypes")
        .select("id")
        .eq("category_id", gamesCategory.id)
        .is("user_id", null)
        .eq("name", "Other")
        .single();
      if (!otherSubtype) throw new Error("'Other' subtype not found for games");
      const gamesCategoryId = gamesCategory.id;
      const otherSubtypeId = otherSubtype.id;

      async function insertItem(params: {
        title: string;
        status: "planned" | "ongoing" | "completed" | "dropped";
        priority: "low" | "medium" | "high" | null;
        notes?: string;
      }) {
        const { data, error } = await user
          .from("items")
          .insert({
            user_id: userId,
            title: params.title,
            category_id: gamesCategoryId,
            subtype_id: otherSubtypeId,
            status: params.status,
            priority: params.priority,
            notes: params.notes ?? null,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error(`insert ${params.title} failed`);
        return data.id as string;
      }

      // Inserted in order -- each insert happens strictly after the last, so
      // created_at strictly increases from Alpha (oldest) to Foxtrot
      // (newest).
      await insertItem({
        title: "Alpha Item",
        status: "planned",
        priority: "low",
        notes: "markerXYZ alpha notes",
      });
      await insertItem({
        title: "Bravo Item",
        status: "ongoing",
        priority: "high",
        notes: "markerXYZ bravo notes",
      });
      await insertItem({ title: "Charlie Item", status: "completed", priority: "high" });
      await insertItem({
        title: "Delta Item",
        status: "dropped",
        priority: "medium",
        notes: "markerXYZ delta notes",
      });
      await insertItem({ title: "Echo Item", status: "ongoing", priority: null });
      await insertItem({ title: "Foxtrot Item", status: "planned", priority: null });

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      const sortSelect = page.getByRole("combobox", { name: "Sort" });
      const statusFilterSelect = page.getByRole("combobox", { name: "Status" });
      const searchBox = page.getByRole("searchbox", { name: "Search" });

      async function expectOrder(titles: string[]) {
        const rows = page.locator("a", {
          hasText: /Alpha Item|Bravo Item|Charlie Item|Delta Item|Echo Item|Foxtrot Item/,
        });
        await expect(rows).toHaveCount(titles.length);
        for (let index = 0; index < titles.length; index++) {
          await expect(rows.nth(index)).toContainText(titles[index]);
        }
      }

      // --- Default (no persisted preference): Sort shows "Recently Added",
      // exactly three options offered, order is created_at desc unchanged.
      await expect(sortSelect).toHaveValue("recently_added");
      const optionLabels = await sortSelect.locator("option").allTextContents();
      expect(optionLabels).toEqual(["Recently Added", "Priority", "Status"]);
      await expectOrder([
        "Foxtrot Item",
        "Echo Item",
        "Delta Item",
        "Charlie Item",
        "Bravo Item",
        "Alpha Item",
      ]);

      // --- Priority sort: High -> Medium -> Low -> no priority (last),
      // created_at desc tie-break within each bucket.
      await sortSelect.selectOption({ label: "Priority" });
      await expectOrder([
        "Charlie Item",
        "Bravo Item",
        "Delta Item",
        "Alpha Item",
        "Foxtrot Item",
        "Echo Item",
      ]);

      // --- Status sort: Ongoing -> Planned -> Completed -> Dropped,
      // created_at desc tie-break within each bucket.
      await sortSelect.selectOption({ label: "Status" });
      await expectOrder([
        "Echo Item",
        "Bravo Item",
        "Foxtrot Item",
        "Alpha Item",
        "Charlie Item",
        "Delta Item",
      ]);

      // --- Sort composes with an active filter (sorts the filtered subset,
      // doesn't ignore it): Status filter = Ongoing narrows to Bravo/Echo;
      // switching Sort to Priority reorders that narrowed pair by priority
      // (Bravo=high before Echo=none) -- a different order than Status sort
      // would have given the same pair (Echo before Bravo), proving this is
      // a real reorder of the filtered set, not leftover Status-sort order.
      await statusFilterSelect.selectOption({ label: "Ongoing" });
      await sortSelect.selectOption({ label: "Priority" });
      await expectOrder(["Bravo Item", "Echo Item"]);
      // The Status *filter* is untouched by the Sort change.
      await expect(statusFilterSelect).toHaveValue("ongoing");

      // --- Clearing filters doesn't change the current sort selection.
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(statusFilterSelect).toHaveValue("");
      await expect(sortSelect).toHaveValue("priority");
      await expectOrder([
        "Charlie Item",
        "Bravo Item",
        "Delta Item",
        "Alpha Item",
        "Foxtrot Item",
        "Echo Item",
      ]);

      // --- Sort composes with an active search term (sorts the searched
      // subset); changing sort doesn't clear the search box, and the search
      // term isn't cleared by a sort change either.
      await searchBox.fill("markerXYZ");
      // Sort is still "priority" from the steps above -- the search-matched
      // subset (Alpha/Bravo/Delta) is reordered by priority: Bravo (high),
      // Delta (medium), Alpha (low).
      await expectOrder(["Bravo Item", "Delta Item", "Alpha Item"]);
      await expect(sortSelect).toHaveValue("priority");
      await expect(searchBox).toHaveValue("markerXYZ");

      await searchBox.fill("");
      await expect(sortSelect).toHaveValue("priority");

      // --- Persistence: reload and confirm the last-chosen sort survives.
      // The persistence write is fire-and-forget (same convention as
      // list_view_mode) -- poll the row directly before reloading, same
      // pattern as category-library.spec.ts, rather than racing the write
      // with a reload.
      await expect
        .poll(async () => {
          const { data } = await user
            .from("user_preferences")
            .select("default_sort")
            .maybeSingle();
          return data?.default_sort ?? null;
        })
        .toBe("priority");

      await page.reload();
      await expect(sortSelect).toHaveValue("priority");
      await expectOrder([
        "Charlie Item",
        "Bravo Item",
        "Delta Item",
        "Alpha Item",
        "Foxtrot Item",
        "Echo Item",
      ]);

      // --- default_sort is one column per user, not per category:
      // navigating to a different category keeps the same sort selected.
      await page.locator("aside").getByRole("link", { name: "Books" }).click();
      await page.waitForURL("**/books");
      await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("priority");

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");
      await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("priority");
      await expectOrder([
        "Charlie Item",
        "Bravo Item",
        "Delta Item",
        "Alpha Item",
        "Foxtrot Item",
        "Echo Item",
      ]);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
