import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #25 (Trash: soft delete, restore, permanent
// delete -- folding in #36's Storage-cleanup scope): the real Delete control
// on the item detail page (deleteItemAction, lib/actions/items.ts), the
// /trash page (getTrashedItems, lib/queries/trash.ts + TrashList.tsx), and
// Restore/Permanent Delete (restoreItemAction/permanentlyDeleteItemAction,
// lib/actions/trash.ts) against the live project. What only a live browser +
// real project can prove is covered here rather than in the mocked unit
// tests (lib/actions/items.test.ts, lib/actions/trash.test.ts,
// lib/queries/trash.test.ts): the inline confirm panels genuinely block a
// write until confirmed, a soft-deleted item truly disappears from the
// category library view and 404s on its own URL, Restore reappears the item
// with its rating/tags intact and updates the Trash list without a reload,
// Permanent Delete actually empties both the `covers` and `attachments`
// Storage folders and cascades every relation table, and RLS (not just the
// app's own checks) blocks a cross-user attack on all three actions.
//
// Test accounts are created via the Supabase Admin API (auth.admin.createUser)
// rather than the public /register flow, same as e2e/item-attachments.spec.ts
// and e2e/cover-upload.spec.ts, to avoid adding to that endpoint's signup
// rate limit. Every account/storage object created here is cleaned up in a
// `finally` block.

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
    rating?: number | null;
    deletedAt?: string | null;
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
      status: "planned",
      rating: fields.rating ?? null,
      deleted_at: fields.deletedAt ?? null,
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${fields.title} failed`);

  return {
    itemId: item.id as string,
    categorySlug: category.slug as string,
    categoryName: category.name as string,
    subtypeName: subtype.name as string,
  };
}

// Scoped to <main> (NavShell.tsx) -- the sidebar nav also renders an
// unordered list of <li> destinations (Dashboard/each category/Lists/
// Trash/Settings), which a bare page.getByRole("listitem") would match too.
// Trash's own rows only ever live in the page content area.
const trashRows = (page: Page) => page.locator("main").getByRole("listitem");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Trash: soft delete, restore, permanent delete (issue #25)", () => {
  test("Delete requires an inline confirm (and is hidden mid-edit), then soft-deletes: the item vanishes from the library and 404s on its own URL, and appears in Trash", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "trash-delete");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertItem(user, userId, { title: "Delete Me Item" });

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      // Delete is only in view mode, same scoping as Edit itself.
      await page.getByRole("button", { name: /^edit$/i }).click();
      await expect(page.getByRole("button", { name: /^delete$/i })).toHaveCount(0);
      await page.getByRole("button", { name: /^cancel$/i }).click();

      // A single click never deletes immediately -- Cancel discards it.
      await page.getByRole("button", { name: /^delete$/i }).click();
      await expect(page.getByText(/delete this item\?/i)).toBeVisible();
      await page.getByRole("button", { name: /^cancel$/i }).click();
      await expect(page.getByText(/delete this item\?/i)).toHaveCount(0);

      const { data: stillThere } = await user
        .from("items")
        .select("deleted_at")
        .eq("id", itemId)
        .single();
      expect(stillThere?.deleted_at).toBeNull();

      // Confirm -> writes deleted_at and redirects to the category page.
      await page.getByRole("button", { name: /^delete$/i }).click();
      await page.getByRole("button", { name: /^confirm$/i }).click();
      await page.waitForURL(`**/${categorySlug}`, { timeout: 15_000 });

      await expect(page.getByText("Delete Me Item")).toHaveCount(0);

      const { data: row } = await user.from("items").select("deleted_at").eq("id", itemId).single();
      expect(row?.deleted_at).not.toBeNull();

      // Its own detail URL now 404s exactly like any other not-found item.
      await page.goto(`/${categorySlug}/${itemId}`);
      await expect(page.getByText(/this page could not be found/i)).toBeVisible();

      // Shows up in Trash with title/category/subtype/deleted date.
      await page.goto("/trash");
      await expect(page.getByText("Delete Me Item")).toBeVisible();
      await expect(page.getByText(/Games.*RPG.*Deleted/)).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Trash lists across all categories, most-recently-deleted first; an empty Trash shows a plain message; Restore un-deletes without a reload and preserves rating, and a stale Restore click fails gracefully", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "trash-restore");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      await loginViaUI(page, email);

      // Nothing deleted yet -- plain empty-state message.
      await page.goto("/trash");
      await expect(page.getByText(/trash is empty/i)).toBeVisible();

      // Three already-soft-deleted items, seeded directly (the Delete
      // trigger itself is covered by the previous test) -- across two
      // different categories (Games and Books), inserted oldest-first so
      // ordering can be asserted against deleted_at, not created_at or
      // insertion order.
      await insertItem(user, userId, {
        title: "Oldest Deleted Book",
        categorySlug: "books",
        subtypeName: "Fiction",
        deletedAt: new Date(Date.now() - 120_000).toISOString(),
      });
      const older = await insertItem(user, userId, {
        title: "Older Deleted Item",
        deletedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const newer = await insertItem(user, userId, {
        title: "Newer Deleted Item",
        rating: 7,
        deletedAt: new Date().toISOString(),
      });
      const { data: tagRow } = await user
        .from("tags")
        .select("id, name")
        .is("user_id", null)
        .limit(1)
        .single();
      if (tagRow) {
        await user.from("item_tags").insert({ item_id: newer.itemId, tag_id: tagRow.id });
      }

      await page.goto("/trash");
      const rows = trashRows(page);
      // All three, across both categories, on one plain list -- not scoped
      // to a single category tab.
      await expect(rows).toHaveCount(3);
      // Most-recently-deleted first.
      await expect(rows.nth(0)).toContainText("Newer Deleted Item");
      await expect(rows.nth(1)).toContainText("Older Deleted Item");
      await expect(rows.nth(2)).toContainText("Oldest Deleted Book");
      await expect(rows.nth(2)).toContainText("Books");
      await expect(rows.nth(2)).toContainText("Fiction");

      // Restore the newer item -- row disappears without a full page
      // reload (no navigation away from /trash).
      const newerRow = rows.filter({ hasText: "Newer Deleted Item" });
      await newerRow.getByRole("button", { name: /^restore$/i }).click();
      await expect(page.getByText("Newer Deleted Item")).toHaveCount(0, { timeout: 15_000 });
      expect(page.url()).toContain("/trash");
      await expect(trashRows(page)).toHaveCount(2);

      // Reappears in the category library view, rating/tag intact. Scoped
      // to the item's own row -- the tag name is also one of the (hidden,
      // but still present in the DOM) filter panel's checkbox labels, which
      // a bare page.getByText(tagRow.name) would ambiguously match too.
      await page.goto(`/${newer.categorySlug}`);
      const itemRow = page.getByRole("link", { name: /Newer Deleted Item/ });
      await expect(itemRow).toBeVisible();
      await expect(itemRow).toContainText("7/10");
      if (tagRow) {
        await expect(itemRow).toContainText(tagRow.name);
      }

      const { data: restoredRow } = await user
        .from("items")
        .select("deleted_at")
        .eq("id", newer.itemId)
        .single();
      expect(restoredRow?.deleted_at).toBeNull();

      // Stale click: permanently delete the still-listed "Older" item out
      // from under the page (simulating a race with another tab/click),
      // then click its Restore button -- must fail gracefully, no crash, no
      // phantom row reappearing.
      await page.goto("/trash");
      await expect(trashRows(page)).toHaveCount(2);
      // The service_role key has no table-level grant on the app's own
      // tables in this project (same finding e2e/testAccount.ts's own
      // comment already documents for user_preferences) -- `user` (the
      // item's real owner, via items_delete_own RLS) is what can actually
      // remove it here, not `admin`.
      await user.from("items").delete().eq("id", older.itemId);
      const olderRow = trashRows(page).filter({ hasText: "Older Deleted Item" });
      await olderRow.getByRole("button", { name: /^restore$/i }).click();
      await expect(page.getByText(/no longer in trash/i)).toBeVisible({ timeout: 15_000 });

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Permanent Delete requires confirmation with irreversible-cannot-be-undone copy, empties both Storage buckets, cascades every relation table, and removes the item from Trash", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let coverPath: string | null = null;
    let attachmentPath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "trash-permdelete");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId } = await insertItem(user, userId, {
        title: "Permanently Delete Me",
        deletedAt: new Date().toISOString(),
      });

      // Real cover + attachment storage objects, plus rows in every
      // cascading relation table, so this test proves both the Storage
      // cleanup AND the FK cascade -- not just the row's own disappearance.
      coverPath = `${userId}/${itemId}/cover`;
      const { error: coverUploadError } = await user.storage
        .from("covers")
        .upload(coverPath, ONE_PIXEL_PNG, { contentType: "image/png" });
      if (coverUploadError) throw coverUploadError;
      await user.from("item_images").insert({ item_id: itemId, storage_path: coverPath, is_cover: true });

      const attachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      attachmentPath = `${userId}/${itemId}/${attachmentId}`;
      const { error: attachUploadError } = await user.storage
        .from("attachments")
        .upload(attachmentPath, Buffer.from("hello"), { contentType: "text/plain" });
      if (attachUploadError) throw attachUploadError;
      await user.from("item_attachments").insert({
        id: attachmentId,
        item_id: itemId,
        storage_path: attachmentPath,
        filename: "hello.txt",
        mime_type: "text/plain",
        size_bytes: 5,
      });

      await user.from("item_links").insert({ item_id: itemId, url: "https://example.com", label: "Example" });

      const { data: tagRow } = await user.from("tags").select("id").is("user_id", null).limit(1).single();
      if (tagRow) await user.from("item_tags").insert({ item_id: itemId, tag_id: tagRow.id });

      const { data: list } = await user
        .from("lists")
        .insert({ user_id: userId, name: "Trash Cascade Test List" })
        .select("id")
        .single();
      if (list) await user.from("list_items").insert({ list_id: list.id, item_id: itemId });

      await loginViaUI(page, email);
      await page.goto("/trash");
      const row = trashRows(page).filter({ hasText: "Permanently Delete Me" });
      await expect(row).toBeVisible();

      await row.getByRole("button", { name: /delete permanently/i }).click();
      await expect(page.getByText(/cannot be undone/i)).toBeVisible();

      // Confirming does the real, irreversible thing -- assert the row
      // disappears from Trash (no reload needed).
      await row.getByRole("button", { name: /^confirm$/i }).click();
      await expect(page.getByText("Permanently Delete Me")).toHaveCount(0, { timeout: 20_000 });

      // The items row itself is really gone (not just soft-deleted again).
      const { data: itemAfter } = await user.from("items").select("id").eq("id", itemId).maybeSingle();
      expect(itemAfter).toBeNull();

      // Both Storage folders are empty -- zero orphaned files. (Storage's
      // service_role access is a separate permission model from the table
      // grants below -- admin.storage.* already works fine here, same
      // precedent as e2e/cover-upload.spec.ts/item-attachments.spec.ts.)
      const { data: coversListing } = await admin.storage.from("covers").list(`${userId}/${itemId}`);
      expect(coversListing ?? []).toHaveLength(0);
      const { data: attachmentsListing } = await admin.storage
        .from("attachments")
        .list(`${userId}/${itemId}`);
      expect(attachmentsListing ?? []).toHaveLength(0);
      coverPath = null;
      attachmentPath = null;

      // Every relation table's row for this item (item_images/
      // item_attachments/item_links/item_tags/list_items, all seeded above)
      // cascaded away via their `on delete cascade` FKs (migrations
      // 20260908140000/20260908150000) -- this DELETE succeeding at all,
      // with no FK-violation error surfaced to the UI (the row disappeared
      // from Trash cleanly above), is the real proof: if any of those FKs
      // weren't `on delete cascade`, Postgres would have rejected the
      // DELETE outright while these child rows still existed, and Confirm
      // would have shown an error instead of removing the row. A direct
      // post-delete SELECT on these child tables to double-check isn't
      // possible from here: their RLS policies gate access through an
      // `exists` join back to the (now-gone) parent items row, so even the
      // real owner's own client can no longer see them regardless of
      // whether they're orphaned or genuinely cascaded -- and the
      // service_role key has no table-level grant on any of these tables in
      // this project (confirmed above for `items` itself; same project-wide
      // choice e2e/testAccount.ts already documents for user_preferences).
      // lib/actions/trash.test.ts's mocked unit coverage separately proves
      // permanentlyDeleteItemAction itself never issues a delete against
      // any of these tables directly -- only against `items`.
      if (list) {
        await user.from("lists").delete().eq("id", list.id);
      }

      await user.auth.signOut();
    } finally {
      if (coverPath) await admin.storage.from("covers").remove([coverPath]);
      if (attachmentPath) await admin.storage.from("attachments").remove([attachmentPath]);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Permanently deleting an item with no cover and no attachments still succeeds -- an empty storage.list() result is not treated as an error", async ({
    page,
  }) => {
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "trash-permdelete-empty");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      await insertItem(user, userId, {
        title: "Nothing In Storage",
        deletedAt: new Date().toISOString(),
      });

      await loginViaUI(page, email);
      await page.goto("/trash");
      const row = trashRows(page).filter({ hasText: "Nothing In Storage" });
      await row.getByRole("button", { name: /delete permanently/i }).click();
      await row.getByRole("button", { name: /^confirm$/i }).click();

      await expect(page.getByText("Nothing In Storage")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByText(/trash is empty/i)).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("cross-user protection: RLS blocks an attacker from restoring or permanently deleting another user's trashed item, or touching its Storage objects", async () => {
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;
    let ownerCoverPath: string | null = null;

    try {
      const { email: ownerEmail, userId: ownerUid } = await createAdminUser(admin, "trash-rls-owner");
      ownerId = ownerUid;
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { itemId } = await insertItem(owner, ownerId, {
        title: "Owner Trashed Item",
        deletedAt: new Date().toISOString(),
      });

      ownerCoverPath = `${ownerId}/${itemId}/cover`;
      const { error: uploadError } = await owner.storage
        .from("covers")
        .upload(ownerCoverPath, ONE_PIXEL_PNG, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { email: attackerEmail, userId: attackerUid } = await createAdminUser(
        admin,
        "trash-rls-attacker",
      );
      attackerId = attackerUid;
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      // items_update_own: attacker can't restore the owner's item.
      const { data: restoreAttempt, error: restoreError } = await attacker
        .from("items")
        .update({ deleted_at: null })
        .eq("id", itemId)
        .select("id");
      expect(restoreError).toBeNull();
      expect(restoreAttempt).toEqual([]);

      // items_delete_own: attacker can't permanently delete the owner's item.
      const { data: deleteAttempt, error: deleteError } = await attacker
        .from("items")
        .delete()
        .eq("id", itemId)
        .select("id");
      expect(deleteError).toBeNull();
      expect(deleteAttempt).toEqual([]);

      // covers_delete_own: attacker can't remove the owner's cover object.
      const { error: storageRemoveError } = await attacker.storage
        .from("covers")
        .remove([ownerCoverPath]);
      // Supabase Storage's own RLS-backed remove() reports success with an
      // empty result for paths it silently can't touch, rather than an
      // error -- so the real assertion is that the object still exists
      // afterward, not the call's own return value.
      void storageRemoveError;

      const { data: stillThere } = await owner
        .from("items")
        .select("deleted_at")
        .eq("id", itemId)
        .single();
      expect(stillThere?.deleted_at).not.toBeNull();

      const { data: coverStillListed } = await owner.storage
        .from("covers")
        .list(`${ownerId}/${itemId}`);
      expect(coverStillListed ?? []).toHaveLength(1);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId && ownerCoverPath) {
        await admin.storage.from("covers").remove([ownerCoverPath]);
      }
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
