import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #23 (Category/subtype/status/tag/rating
// filtering). One disposable account, one seeded set of items, and a single
// long test that walks through each acceptance criterion in turn -- same
// "one account, many assertions in sequence" shape as e2e/search.spec.ts,
// rather than one account per scenario. Items/tags are inserted directly
// against the live DB via the signed-in test user's own RLS-scoped client
// (no in-app flow sets subtype+status+rating+tags together in one step).
//
// Seeded items (category: Games):
//   Elden Ring    -- RPG,    planned,   rating 9,    tags: [fantasy]
//   Hollow Knight -- Action, completed, rating 8,    tags: [indie]
//   Hades         -- Action, completed, rating null, tags: []
//   Silent Entry  -- RPG,    dropped,   rating 5,    tags: [fantasy, indie]
//   Quiet Entry   -- Action, planned,   rating null, tags: []

async function loginViaUI(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Filtering (issue #23)", () => {
  test("subtype/status/rating/tag filters work in isolation, AND together, OR within tags, exclude NULL ratings, AND with an active search term, show a clear empty state on zero matches, and Clear filters resets everything", async ({
    page,
  }) => {
    // This single test walks through many sequential filter combinations
    // (per-scenario debounce + several toBeVisible/toHaveCount assertions
    // each) -- comfortably past the default 30s test timeout even though
    // each individual step is fast, so it gets a longer budget rather than
    // being split into several accounts (see this file's own "pace
    // test-account creation" reasoning).
    test.setTimeout(120_000);

    const email = randomTestEmail("filters");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      // Created directly via the admin API (pre-confirmed), not the public
      // /register flow -- this test seeds five items plus tag rows and
      // walks through many filter combinations against them, so it doesn't
      // need registration's own behavior exercised too (that's #7/#9's
      // coverage), just a disposable, already-confirmed account to log
      // into.
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (createError || !created.user) throw createError ?? new Error("createUser failed");
      userId = created.user.id;

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: gamesCategory } = await user
        .from("categories")
        .select("id")
        .eq("slug", "games")
        .single();
      if (!gamesCategory) throw new Error("games category not found");
      const gamesCategoryId = gamesCategory.id;

      const { data: subtypes } = await user
        .from("subtypes")
        .select("id, name")
        .eq("category_id", gamesCategory.id)
        .in("name", ["RPG", "Action"]);
      const rpg = subtypes?.find((s) => s.name === "RPG");
      const action = subtypes?.find((s) => s.name === "Action");
      if (!rpg || !action) throw new Error("expected subtypes not found");

      const { data: tags } = await user
        .from("tags")
        .select("id, name")
        .in("name", ["fantasy", "indie"]);
      const fantasyTag = tags?.find((t) => t.name === "fantasy");
      const indieTag = tags?.find((t) => t.name === "indie");
      if (!fantasyTag || !indieTag) throw new Error("expected predefined tags not found");

      async function insertItem(params: {
        title: string;
        subtypeId: string;
        status: "planned" | "ongoing" | "completed" | "dropped";
        rating: number | null;
      }) {
        const { data, error } = await user
          .from("items")
          .insert({
            user_id: userId,
            title: params.title,
            category_id: gamesCategoryId,
            subtype_id: params.subtypeId,
            status: params.status,
            rating: params.rating,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error(`insert ${params.title} failed`);
        return data.id as string;
      }

      const eldenRingId = await insertItem({
        title: "Elden Ring",
        subtypeId: rpg.id,
        status: "planned",
        rating: 9,
      });
      const hollowKnightId = await insertItem({
        title: "Hollow Knight",
        subtypeId: action.id,
        status: "completed",
        rating: 8,
      });
      await insertItem({
        title: "Hades",
        subtypeId: action.id,
        status: "completed",
        rating: null,
      });
      const silentEntryId = await insertItem({
        title: "Silent Entry",
        subtypeId: rpg.id,
        status: "dropped",
        rating: 5,
      });
      await insertItem({
        title: "Quiet Entry",
        subtypeId: action.id,
        status: "planned",
        rating: null,
      });

      await user.from("item_tags").insert([
        { item_id: eldenRingId, tag_id: fantasyTag.id },
        { item_id: hollowKnightId, tag_id: indieTag.id },
        { item_id: silentEntryId, tag_id: fantasyTag.id },
        { item_id: silentEntryId, tag_id: indieTag.id },
      ]);

      await loginViaUI(page, email);
      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      const allTitles = ["Elden Ring", "Hollow Knight", "Hades", "Silent Entry", "Quiet Entry"];
      async function expectVisible(titles: string[]) {
        for (const title of allTitles) {
          const link = page.getByRole("link", { name: new RegExp(title) });
          if (titles.includes(title)) {
            await expect(link).toBeVisible();
          } else {
            await expect(link).toHaveCount(0);
          }
        }
      }

      const subtypeSelect = page.getByRole("combobox", { name: "Subtype" });
      const statusSelect = page.getByRole("combobox", { name: "Status" });
      const ratingSelect = page.getByRole("combobox", { name: "Rating" });
      const searchBox = page.getByRole("searchbox", { name: "Search" });

      // Baseline: every filter at its default, all five items visible.
      await expect(subtypeSelect).toHaveValue("");
      await expect(statusSelect).toHaveValue("");
      await expectVisible(allTitles);

      // Open the Tags disclosure once -- checking/unchecking a checkbox
      // inside never closes it, so this stays open for the rest of the
      // test; only the summary click itself toggles open/closed state.
      await page.getByText("Tags", { exact: true }).click();

      // --- Subtype filter in isolation ---
      await subtypeSelect.selectOption({ label: "RPG" });
      await expectVisible(["Elden Ring", "Silent Entry"]);
      await subtypeSelect.selectOption({ label: "All subtypes" });
      await expectVisible(allTitles);

      // --- Status filter in isolation ---
      await statusSelect.selectOption({ label: "Completed" });
      await expectVisible(["Hollow Knight", "Hades"]);
      await statusSelect.selectOption({ label: "All statuses" });
      await expectVisible(allTitles);

      // --- Rating filter in isolation, incl. NULL never matching a threshold ---
      await ratingSelect.selectOption({ label: "8+ rating" });
      await expectVisible(["Elden Ring", "Hollow Knight"]);
      await ratingSelect.selectOption({ label: "Any rating" });
      await expectVisible(allTitles);

      // --- Tags filter: single tag, then OR-match across two selected tags ---
      await page.getByLabel("fantasy", { exact: true }).check();
      await expectVisible(["Elden Ring", "Silent Entry"]);
      await page.getByLabel("indie", { exact: true }).check();
      await expectVisible(["Elden Ring", "Hollow Knight", "Silent Entry"]);
      await page.getByLabel("fantasy", { exact: true }).uncheck();
      await page.getByLabel("indie", { exact: true }).uncheck();
      await expectVisible(allTitles);

      // --- Combined filters AND across dimensions (RPG + Planned + rating>=8 + fantasy) ---
      await subtypeSelect.selectOption({ label: "RPG" });
      await statusSelect.selectOption({ label: "Planned" });
      await ratingSelect.selectOption({ label: "8+ rating" });
      await page.getByLabel("fantasy", { exact: true }).check();
      // Only Elden Ring satisfies every dimension -- Silent Entry is RPG and
      // has the fantasy tag, but is Dropped (not Planned) and rated 5 (not
      // >=8), so AND-across-dimensions must exclude it.
      await expectVisible(["Elden Ring"]);

      // --- Zero-match combination: same filters, Status switched to
      // Completed -- no item is RPG + Completed + rating>=8 + fantasy.
      // Must show the clear empty state, not an error or blank screen.
      await statusSelect.selectOption({ label: "Completed" });
      await expect(page.getByText("No items match the selected filters.")).toBeVisible();
      await expect(page.getByText(/^No items in Games yet\.$/)).toHaveCount(0);
      for (const title of allTitles) {
        await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
      }

      // --- Clear filters resets all four controls in one action ---
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(subtypeSelect).toHaveValue("");
      await expect(statusSelect).toHaveValue("");
      await expect(ratingSelect).toHaveValue("");
      await expectVisible(allTitles);

      // --- Filters AND with an active search term (not OR, not replacing it) ---
      // "Entry" matches both Silent Entry (RPG) and Quiet Entry (Action) by
      // title alone.
      await searchBox.fill("Entry");
      await expectVisible(["Silent Entry", "Quiet Entry"]);
      // Adding Subtype=RPG on top must narrow to the AND of both --
      // Quiet Entry (Action) drops out, Silent Entry (RPG) remains.
      await subtypeSelect.selectOption({ label: "RPG" });
      await expectVisible(["Silent Entry"]);
      // Clearing the search box falls back to filters-only: every RPG item.
      await searchBox.fill("");
      await expectVisible(["Elden Ring", "Silent Entry"]);
      // Clearing the filter too falls back to the full unfiltered list.
      await subtypeSelect.selectOption({ label: "All subtypes" });
      await expectVisible(allTitles);

      // --- List/Card toggle, Add/Quick Add, and the search box all remain
      // usable with filters applied.
      await subtypeSelect.selectOption({ label: "RPG" });
      await expect(page.getByRole("link", { name: "Add item" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Quick Add" })).toBeVisible();
      await page.getByRole("button", { name: "Card" }).click();
      await expect(page.getByRole("button", { name: "Card" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expectVisible(["Elden Ring", "Silent Entry"]);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
