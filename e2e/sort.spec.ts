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
      // order is created_at desc unchanged. Five options are offered as of
      // issue #39 (Rating/Title added) -- this test still only exercises
      // the original three; the other two plus the direction toggle are
      // e2e/sort.spec.ts's own "issue #39" describe block below.
      await expect(sortSelect).toHaveValue("recently_added");
      const optionLabels = await sortSelect.locator("option").allTextContents();
      expect(optionLabels).toEqual([
        "Recently Added",
        "Priority",
        "Status",
        "Rating",
        "Title (A-Z)",
      ]);
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

// End-to-end coverage for issue #39 (direction toggle + Rating/Title
// dimensions, #40 folded in). One disposable account, one seeded set of
// items chosen to exercise every dimension in both directions plus the
// NULL-last/unset-last pinning and the case-insensitive Title example from
// the issue's own acceptance criteria ("apple" before "Banana" before
// "cherry").
//
// Seeded items (category: Games, inserted in this order -- oldest first):
//   1. apple Item    -- rating 5,    priority high,   status ongoing
//   2. Banana Item   -- rating null, priority medium, status planned
//   3. cherry Item   -- rating 8,    priority low,    status completed
//   4. Delta Item    -- rating 2,    priority null,   status dropped
//   5. Echo Item     -- rating null, priority high,   status ongoing
//   6. Foxtrot Item  -- rating 9,    priority null,   status planned
//
// Expected orders (worked out by hand from the acceptance criteria's own
// bucket orders + the fixed created_at-desc tie-break, which never itself
// reverses):
//   Recently Added desc (default): Foxtrot, Echo, Delta, cherry, Banana, apple
//   Recently Added asc:            apple, Banana, cherry, Delta, Echo, Foxtrot
//   Priority desc (High->Low, default): Echo, apple, Banana, cherry, Foxtrot, Delta
//     (high bucket ties Echo/apple -> Echo newer; unset bucket ties Delta/Foxtrot -> Foxtrot newer, still last)
//   Priority asc (Low->High): cherry, Banana, Echo, apple, Foxtrot, Delta
//     (unset bucket order unchanged -- still last, same internal tie-break)
//   Status desc (Ongoing->Dropped, default): Echo, apple, Foxtrot, Banana, cherry, Delta
//     (ongoing ties Echo/apple -> Echo newer; planned ties Foxtrot/Banana -> Foxtrot newer)
//   Status asc (Dropped->Ongoing, fully reversed): Delta, cherry, Foxtrot, Banana, Echo, apple
//   Rating desc (Highest first, default; NULL always last): Foxtrot, cherry, apple, Delta, Echo, Banana
//     (NULL bucket ties Echo/Banana -> Echo newer, same tie-break both directions)
//   Rating asc (Lowest first; NULL still last): Delta, apple, cherry, Foxtrot, Echo, Banana
//   Title desc (Z->A): Foxtrot, Echo, Delta, cherry, Banana, apple
//   Title asc (A->Z, default, case-insensitive): apple, Banana, cherry, Delta, Echo, Foxtrot
//     (a case-SENSITIVE ASCII sort would instead read Banana, Delta, Echo,
//     Foxtrot, apple, cherry -- this dataset is deliberately chosen so the
//     two orders differ, proving the comparison is genuinely
//     case-insensitive rather than coincidentally matching)

async function registerViaUI39(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Sort direction toggle + Rating/Title dimensions (issue #39)", () => {
  test("all five dimensions sort correctly in both directions, direction resets when switching dimensions, and both dimension + direction persist across reload", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const email = randomTestEmail("sortdir");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI39(page, email);
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
        rating: number | null;
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
            rating: params.rating,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error(`insert ${params.title} failed`);
        return data.id as string;
      }

      // Inserted in order -- created_at strictly increases from apple
      // (oldest) to Foxtrot (newest).
      await insertItem({ title: "apple Item", status: "ongoing", priority: "high", rating: 5 });
      await insertItem({
        title: "Banana Item",
        status: "planned",
        priority: "medium",
        rating: null,
      });
      await insertItem({ title: "cherry Item", status: "completed", priority: "low", rating: 8 });
      await insertItem({ title: "Delta Item", status: "dropped", priority: null, rating: 2 });
      await insertItem({ title: "Echo Item", status: "ongoing", priority: "high", rating: null });
      await insertItem({ title: "Foxtrot Item", status: "planned", priority: null, rating: 9 });

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      const sortSelect = page.getByRole("combobox", { name: "Sort" });
      const directionButton = page.getByRole("button", { name: "Sort direction" });

      async function expectOrder(titles: string[]) {
        const rows = page.locator("a", {
          hasText: /apple Item|Banana Item|cherry Item|Delta Item|Echo Item|Foxtrot Item/,
        });
        await expect(rows).toHaveCount(titles.length);
        for (let index = 0; index < titles.length; index++) {
          await expect(rows.nth(index)).toContainText(titles[index]);
        }
      }

      // --- Sort dropdown now offers five options; direction defaults to
      // Recently Added's own default ("Newest first") with no persisted
      // preference.
      const optionLabels = await sortSelect.locator("option").allTextContents();
      expect(optionLabels).toEqual([
        "Recently Added",
        "Priority",
        "Status",
        "Rating",
        "Title (A-Z)",
      ]);
      await expect(directionButton).toHaveText("Newest first");
      await expectOrder([
        "Foxtrot Item",
        "Echo Item",
        "Delta Item",
        "cherry Item",
        "Banana Item",
        "apple Item",
      ]);

      // --- Recently Added: toggling direction flips to Oldest first.
      await directionButton.click();
      await expect(directionButton).toHaveText("Oldest first");
      await expectOrder([
        "apple Item",
        "Banana Item",
        "cherry Item",
        "Delta Item",
        "Echo Item",
        "Foxtrot Item",
      ]);

      // --- Switching to Priority resets direction to Priority's own
      // default ("High → Low"), never carrying over Recently Added's "asc".
      await sortSelect.selectOption({ label: "Priority" });
      await expect(directionButton).toHaveText("High → Low");
      await expectOrder([
        "Echo Item",
        "apple Item",
        "Banana Item",
        "cherry Item",
        "Foxtrot Item",
        "Delta Item",
      ]);

      // --- Priority reversed: only the High/Medium/Low run reverses --
      // "no priority set" (Delta/Foxtrot) stays pinned last either way.
      await directionButton.click();
      await expect(directionButton).toHaveText("Low → High");
      await expectOrder([
        "cherry Item",
        "Banana Item",
        "Echo Item",
        "apple Item",
        "Foxtrot Item",
        "Delta Item",
      ]);

      // --- Status default (Ongoing -> Dropped), direction resets again.
      await sortSelect.selectOption({ label: "Status" });
      await expect(directionButton).toHaveText("Ongoing → Dropped");
      await expectOrder([
        "Echo Item",
        "apple Item",
        "Foxtrot Item",
        "Banana Item",
        "cherry Item",
        "Delta Item",
      ]);

      // --- Status reversed: the whole bucket order flips end-to-end.
      await directionButton.click();
      await expect(directionButton).toHaveText("Dropped → Ongoing");
      await expectOrder([
        "Delta Item",
        "cherry Item",
        "Foxtrot Item",
        "Banana Item",
        "Echo Item",
        "apple Item",
      ]);

      // --- Rating default (Highest first); items with no rating (Banana,
      // Echo) always sort last, never first or interleaved.
      await sortSelect.selectOption({ label: "Rating" });
      await expect(directionButton).toHaveText("Highest first");
      await expectOrder([
        "Foxtrot Item",
        "cherry Item",
        "apple Item",
        "Delta Item",
        "Echo Item",
        "Banana Item",
      ]);

      // --- Rating reversed (Lowest first) -- unrated items still sort
      // last, in the same relative order (tie-break is fixed created_at
      // desc, never itself reversed by direction).
      await directionButton.click();
      await expect(directionButton).toHaveText("Lowest first");
      await expectOrder([
        "Delta Item",
        "apple Item",
        "cherry Item",
        "Foxtrot Item",
        "Echo Item",
        "Banana Item",
      ]);

      // --- Title default (A -> Z), case-insensitive: "apple" interleaves
      // before "Banana" before "cherry" by letter, not grouped by case (a
      // case-sensitive ASCII sort would instead read Banana/Delta/Echo/
      // Foxtrot/apple/cherry).
      await sortSelect.selectOption({ label: "Title (A-Z)" });
      await expect(directionButton).toHaveText("A → Z");
      await expectOrder([
        "apple Item",
        "Banana Item",
        "cherry Item",
        "Delta Item",
        "Echo Item",
        "Foxtrot Item",
      ]);

      // --- Title reversed (Z -> A).
      await directionButton.click();
      await expect(directionButton).toHaveText("Z → A");
      await expectOrder([
        "Foxtrot Item",
        "Echo Item",
        "Delta Item",
        "cherry Item",
        "Banana Item",
        "apple Item",
      ]);

      // --- Persistence: both the dimension (title) and the toggled
      // direction (desc) survive a reload. Poll the row directly before
      // reloading (fire-and-forget persistence), same pattern as the #24
      // sort test above.
      await expect
        .poll(async () => {
          const { data } = await user
            .from("user_preferences")
            .select("default_sort, default_sort_direction")
            .maybeSingle();
          return data ?? null;
        })
        .toEqual({ default_sort: "title", default_sort_direction: "desc" });

      await page.reload();
      await expect(sortSelect).toHaveValue("title");
      await expect(directionButton).toHaveText("Z → A");
      await expectOrder([
        "Foxtrot Item",
        "Echo Item",
        "Delta Item",
        "cherry Item",
        "Banana Item",
        "apple Item",
      ]);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
