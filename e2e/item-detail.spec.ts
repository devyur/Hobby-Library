import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #13 (Item detail page, read-only). There is
// no in-app way to create an item/link/attachment yet (#14/#15/#20/#21), so
// these specs insert rows directly against the live DB using the signed-in
// test user's own (anon-key, RLS-scoped) client -- same approach
// category-library.spec.ts (#12) used. Each test registers its own
// disposable account(s) and deletes them (plus any uploaded storage object)
// afterward.

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
  await page.waitForURL("**/dashboard");
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Item detail page (issue #13)", () => {
  test("fully-populated item: every field, tag, link, and attachment renders; Notes/Review are visually distinct", async ({
    page,
  }) => {
    const email = randomTestEmail("itemdetail-full");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let coverStoragePath: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: category } = await user
        .from("categories")
        .select("id, name")
        .eq("slug", "games")
        .single();
      if (!category) throw new Error("games category not found");

      const { data: subtype } = await user
        .from("subtypes")
        .select("id, name")
        .eq("category_id", category.id)
        .eq("name", "RPG")
        .single();
      if (!subtype) throw new Error("RPG subtype not found");

      const { data: tags } = await user
        .from("tags")
        .select("id, name")
        .in("name", ["fantasy", "dark", "indie", "classic", "long"]);
      if (!tags || tags.length < 5) throw new Error("expected predefined tags not found");

      const { data: item } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Elden Ring",
          category_id: category.id,
          subtype_id: subtype.id,
          status: "planned",
          priority: "high",
          rating: 9,
          notes: "Working notes: started the tutorial area.",
          review: "A sprawling, considered opinion of the whole game.",
          completed_at: "2026-02-01T00:00:00.000Z",
        })
        .select("id, created_at")
        .single();
      if (!item) throw new Error("insert Elden Ring failed");

      await user
        .from("item_tags")
        .insert(tags.map((tag) => ({ item_id: item.id, tag_id: tag.id })));

      coverStoragePath = `${userId}/${item.id}/cover.png`;
      const { error: uploadError } = await user.storage
        .from("covers")
        .upload(coverStoragePath, ONE_PIXEL_PNG, { contentType: "image/png" });
      if (uploadError) throw uploadError;
      const { error: imageInsertError } = await user.from("item_images").insert({
        item_id: item.id,
        storage_path: coverStoragePath,
        is_cover: true,
      });
      if (imageInsertError) throw imageInsertError;

      await user.from("item_links").insert([
        { item_id: item.id, url: "https://store.example.com/elden-ring", label: "Store page" },
        { item_id: item.id, url: "https://wiki.example.com/elden-ring", label: null },
      ]);

      await user.from("item_attachments").insert({
        item_id: item.id,
        storage_path: `${userId}/${item.id}/notes.txt`,
        filename: "notes.txt",
        mime_type: "text/plain",
        size_bytes: 43008,
      });

      await page.goto(`/games/${item.id}`);

      // Header / identity fields.
      const title = page.getByRole("heading", { name: "Elden Ring", level: 1 });
      await expect(title).toBeVisible();
      const titleClass = await title.getAttribute("class");
      expect(titleClass).toMatch(/font-semibold/);

      await expect(page.getByText("Games · RPG")).toBeVisible();
      await expect(page.getByText("Planned")).toBeVisible();
      await expect(page.getByText("9/10")).toBeVisible();
      await expect(page.getByText("High")).toBeVisible();
      await expect(page.getByText("Feb 1, 2026")).toBeVisible(); // completed_at

      // Cover: real signed-URL image renders.
      await expect(page.getByRole("img", { name: "Cover for Elden Ring" })).toBeVisible();

      // Tags: all 5 render, no "+N" truncation (unlike the library view).
      // Not exact-text: issue #17 wraps each tag name together with its own
      // remove ("x") control in the same element.
      for (const name of ["fantasy", "dark", "indie", "classic", "long"]) {
        await expect(page.getByText(name)).toBeVisible();
      }
      await expect(page.getByText(/^\+\d+$/)).toHaveCount(0);

      // Notes vs. Review: both independently rendered, distinct containers.
      await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
      const notesBlock = page.getByText("Working notes: started the tutorial area.");
      const reviewBlock = page.getByText("A sprawling, considered opinion of the whole game.");
      await expect(notesBlock).toBeVisible();
      await expect(reviewBlock).toBeVisible();
      const notesClass = await notesBlock.getAttribute("class");
      const reviewClass = await reviewBlock.getAttribute("class");
      expect(notesClass).not.toBe(reviewClass);

      // Links: label used when set, raw url used when label is null, both
      // open in a new tab.
      const storeLink = page.getByRole("link", { name: "Store page" });
      await expect(storeLink).toHaveAttribute("href", "https://store.example.com/elden-ring");
      await expect(storeLink).toHaveAttribute("target", "_blank");
      await expect(storeLink).toHaveAttribute("rel", "noopener noreferrer");
      await expect(
        page.getByRole("link", { name: "https://wiki.example.com/elden-ring" }),
      ).toBeVisible();

      // Attachments: filename, human-readable size, and mime type as plain
      // metadata -- no download link.
      await expect(page.getByText("notes.txt")).toBeVisible();
      await expect(page.getByText("42 KB · text/plain")).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId && coverStoragePath) {
        await admin.storage.from("covers").remove([coverStoragePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("bare-minimum item: null rating/priority/completed_at/notes/review render nothing, and Tags/Links/Attachments show their empty states correctly", async ({
    page,
  }) => {
    const email = randomTestEmail("itemdetail-empty");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: category } = await user
        .from("categories")
        .select("id, name")
        .eq("slug", "books")
        .single();
      if (!category) throw new Error("books category not found");

      const { data: subtype } = await user
        .from("subtypes")
        .select("id, name")
        .eq("category_id", category.id)
        .limit(1)
        .single();
      if (!subtype) throw new Error("no subtype found for books");

      const { data: item } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Untitled Draft",
          category_id: category.id,
          subtype_id: subtype.id,
          status: "ongoing",
          priority: null,
          rating: null,
        })
        .select("id")
        .single();
      if (!item) throw new Error("insert Untitled Draft failed");

      await page.goto(`/books/${item.id}`);

      await expect(page.getByRole("heading", { name: "Untitled Draft", level: 1 })).toBeVisible();
      await expect(page.getByText("Ongoing")).toBeVisible();

      // No rating badge ("X/10") and no priority badge at all.
      await expect(page.getByText(/\/10/)).toHaveCount(0);
      await expect(page.getByText(/^(Low|Medium|High)$/)).toHaveCount(0);

      // No cover -> the defined placeholder, not a broken/empty box.
      await expect(
        page.getByRole("img", { name: /no cover image for untitled draft/i }),
      ).toBeVisible();

      // The Tags heading itself always renders now (issue #17 made it an
      // always-interactive add-tag section, not conditional on already
      // having tags) -- but with no tag chips/remove controls attached.
      await expect(page.getByRole("heading", { name: "Tags" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Remove /i })).toHaveCount(0);

      // Neither Notes nor Review heading/section appears.
      await expect(page.getByRole("heading", { name: "Notes" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Review" })).toHaveCount(0);

      // Links/Attachments headings always render, with explicit empty-state
      // text rather than being hidden.
      await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();
      await expect(page.getByText("No links yet")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();
      await expect(page.getByText("No attachments yet")).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("not-found collapsing: nonexistent id, another user's item, category/slug mismatch, soft-deleted item, and a malformed UUID are all indistinguishable plain 404s", async ({
    page,
    // Heaviest spec in the suite (2 UI registrations + 1 UI login + 5 page
    // navigations) -- the default 30s budget is comfortable in isolation
    // but tight under full fullyParallel contention against the shared dev
    // server, same class of slowdown already visible in nav.spec.ts's
    // heaviest test; double it here rather than lower everyone's default.
  }) => {
    test.setTimeout(60_000);
    const ownerEmail = randomTestEmail("itemdetail-nf-owner");
    const otherEmail = randomTestEmail("itemdetail-nf-other");
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let otherId: string | null = null;

    try {
      await registerViaUI(page, ownerEmail);
      ownerId = await getUserIdByEmail(admin, ownerEmail);
      if (!ownerId) throw new Error("owner id not found after registration");
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);

      const { data: gamesCategory } = await owner
        .from("categories")
        .select("id")
        .eq("slug", "games")
        .single();
      const { data: booksCategory } = await owner
        .from("categories")
        .select("id")
        .eq("slug", "books")
        .single();
      if (!gamesCategory || !booksCategory) throw new Error("category lookup failed");

      const { data: gamesSubtype } = await owner
        .from("subtypes")
        .select("id")
        .eq("category_id", gamesCategory.id)
        .limit(1)
        .single();
      if (!gamesSubtype) throw new Error("no games subtype found");

      // A live, real Games item owned by `owner` -- used for the
      // category-mismatch (opened via /books/...) and soft-deleted cases.
      const { data: ownerItem } = await owner
        .from("items")
        .insert({
          user_id: ownerId,
          title: "Owner's Item",
          category_id: gamesCategory.id,
          subtype_id: gamesSubtype.id,
          status: "planned",
        })
        .select("id")
        .single();
      if (!ownerItem) throw new Error("insert Owner's Item failed");

      const { data: deletedItem } = await owner
        .from("items")
        .insert({
          user_id: ownerId,
          title: "Deleted Item",
          category_id: gamesCategory.id,
          subtype_id: gamesSubtype.id,
          status: "planned",
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!deletedItem) throw new Error("insert Deleted Item failed");

      // A second, unrelated account owning its own item -- proves
      // `owner` viewing IT gets the same 404 as a wholly nonexistent id.
      // /register redirects an already-authenticated visitor straight to
      // /dashboard (see register/page.tsx), so `owner`'s session must be
      // cleared before registering `other` through the same `page`.
      await page.context().clearCookies();
      await registerViaUI(page, otherEmail);
      otherId = await getUserIdByEmail(admin, otherEmail);
      if (!otherId) throw new Error("other user id not found after registration");
      const other = await createSupabaseUserClient(otherEmail, TEST_PASSWORD);
      const { data: otherSubtype } = await other
        .from("subtypes")
        .select("id")
        .eq("category_id", gamesCategory.id)
        .limit(1)
        .single();
      if (!otherSubtype) throw new Error("no games subtype found for other user");
      const { data: otherItem } = await other
        .from("items")
        .insert({
          user_id: otherId,
          title: "Other User's Item",
          category_id: gamesCategory.id,
          subtype_id: otherSubtype.id,
          status: "planned",
        })
        .select("id")
        .single();
      if (!otherItem) throw new Error("insert Other User's Item failed");
      await other.auth.signOut();

      // Switch the browser session back to `owner` for every not-found case.
      await page.context().clearCookies();
      await loginViaUI(page, ownerEmail);

      const notFoundText = /this page could not be found/i;
      const NONEXISTENT_UUID = "00000000-0000-4000-8000-000000000000";

      await page.goto(`/games/${NONEXISTENT_UUID}`);
      await expect(page.getByText(notFoundText)).toBeVisible();

      await page.goto(`/games/${otherItem.id}`);
      await expect(page.getByText(notFoundText)).toBeVisible();

      await page.goto(`/books/${ownerItem.id}`); // real item, wrong category slug
      await expect(page.getByText(notFoundText)).toBeVisible();

      await page.goto(`/games/${deletedItem.id}`);
      await expect(page.getByText(notFoundText)).toBeVisible();

      await page.goto("/games/not-a-valid-uuid");
      await expect(page.getByText(notFoundText)).toBeVisible();

      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (otherId) await admin.auth.admin.deleteUser(otherId);
    }
  });
});
