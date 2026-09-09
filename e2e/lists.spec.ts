import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #26 (Custom lists): the real create/
// rename/delete controls on lists/page.tsx (ListsOverview.tsx +
// lib/actions/lists.ts), the add/remove item picker on
// lists/[listId]/page.tsx (ListDetailEditor.tsx), and the "trashed member
// item hides from the list but its list_items row survives, and it
// reappears automatically on Restore" rule this issue adds on top of #25.
// What only a live browser + real project can prove is covered here rather
// than in the mocked unit tests (lib/actions/lists.test.ts,
// lib/queries/lists.test.ts): the inline confirm/rename panels genuinely
// gate a write until confirmed, the cross-category picker really only
// offers the caller's own non-deleted items and drops an already-added one
// without a re-fetch, a trashed member item really disappears from the
// list's display while its Trash-page Restore control really brings it
// back with no action needed here, a listId for another user's list 404s
// exactly like [category]/[itemId] does, and RLS (not just the app's own
// ownership checks) blocks a cross-user attack on lists/list_items writes.
// Permanently deleting a list member item cascading the list_items row is
// already covered live by e2e/trash.spec.ts's own Permanent Delete test
// (which seeds a list for exactly that purpose) -- not duplicated here.
//
// Test accounts are created via the Supabase Admin API
// (auth.admin.createUser) rather than the public /register flow, same as
// e2e/trash.spec.ts and friends, to avoid adding to that endpoint's signup
// rate limit. Every account created here is cleaned up in a `finally` block.

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

// Scoped to <main> -- the sidebar nav also renders an unordered list of
// <li> destinations (Dashboard/each category/Lists/Trash/Settings), which a
// bare page.getByRole("listitem") would match too. Same precedent as
// e2e/trash.spec.ts's own `trashRows` helper.
const rows = (page: Page) => page.locator("main").getByRole("listitem");

test.describe("Custom lists (issue #26)", () => {
  test("Create/rename/delete a list: blank names rejected, duplicate names allowed, zero lists shows an empty state, and opening a list navigates to its detail page", async ({
    page,
  }) => {
    // Generous overall timeout: this test exercises several distinct first-
    // hit Server Actions (create/rename/delete) plus the [listId] route --
    // Turbopack dev compiles each lazily on first invocation, same
    // reasoning as the per-assertion timeout below.
    test.setTimeout(90_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "lists-crud");
      userId = id;

      await loginViaUI(page, email);
      await page.goto("/lists");

      // Zero lists -> empty state, not a blank page.
      await expect(page.getByText(/no lists yet/i)).toBeVisible();

      // Blank/whitespace-only name is rejected inline, never silently
      // trimmed to empty or silently accepted -- the Create button itself
      // stays disabled for an all-whitespace value.
      const nameInput = page.getByLabel("New list name");
      await nameInput.fill("   ");
      await expect(page.getByRole("button", { name: /^create list$/i })).toBeDisabled();

      await nameInput.fill("Play next");
      await page.getByRole("button", { name: /^create list$/i }).click();
      // Generous timeout on this first Server Action call -- Turbopack dev
      // compiles the route/action lazily on first hit, same reasoning
      // e2e/trash.spec.ts's own post-action assertions already give
      // themselves room for.
      await expect(rows(page).filter({ hasText: "Play next" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/no lists yet/i)).toHaveCount(0);

      // Duplicate names across the user's own lists are explicitly allowed
      // -- no validation error, both rows exist afterward.
      await nameInput.fill("Play next");
      await page.getByRole("button", { name: /^create list$/i }).click();
      await expect(rows(page).filter({ hasText: "Play next" })).toHaveCount(2);

      // Rename the first one -- same blank-name validation as Create.
      const firstRow = rows(page).filter({ hasText: "Play next" }).first();
      await firstRow.getByRole("button", { name: /^rename$/i }).click();
      const renameInput = page.getByLabel("List name", { exact: true });
      await renameInput.fill("");
      await expect(page.getByRole("button", { name: /^save$/i })).toBeDisabled();
      await renameInput.fill("Weekend Watchlist");
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(rows(page).filter({ hasText: "Weekend Watchlist" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(rows(page).filter({ hasText: "Play next" })).toHaveCount(1);

      // Opening a list navigates to its detail page and shows its own
      // empty state (zero items, but still a working add-item control).
      await rows(page).filter({ hasText: "Weekend Watchlist" }).getByRole("link").click();
      await page.waitForURL("**/lists/*");
      await expect(page.getByRole("heading", { name: "Weekend Watchlist" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/this list has no items yet/i)).toBeVisible();

      // Delete requires a confirm step, same precedent as item Delete --
      // Cancel discards it, Confirm actually removes the row.
      await page.goto("/lists");
      const remainingRow = rows(page).filter({ hasText: "Play next" });
      await remainingRow.getByRole("button", { name: /^delete$/i }).click();
      await expect(page.getByText(/the list is removed/i)).toBeVisible();
      await page.getByRole("button", { name: /^cancel$/i }).click();
      await expect(page.getByText(/the list is removed/i)).toHaveCount(0);
      await expect(rows(page).filter({ hasText: "Play next" })).toBeVisible();

      await remainingRow.getByRole("button", { name: /^delete$/i }).click();
      await page.getByRole("button", { name: /^confirm$/i }).click();
      await expect(rows(page).filter({ hasText: "Play next" })).toHaveCount(0, {
        timeout: 15_000,
      });

      await page.goto("/dashboard");
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("A listId for another user's list, or a nonexistent one, 404s the same indistinguishable way", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let viewerId: string | null = null;

    try {
      const { email: ownerEmail, userId: ownerUid } = await createAdminUser(
        admin,
        "lists-404-owner",
      );
      ownerId = ownerUid;
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { data: ownerList } = await owner
        .from("lists")
        .insert({ user_id: ownerId, name: "Owner's private list" })
        .select("id")
        .single();
      if (!ownerList) throw new Error("failed to seed owner's list");

      const { email: viewerEmail, userId: viewerUid } = await createAdminUser(
        admin,
        "lists-404-viewer",
      );
      viewerId = viewerUid;

      await loginViaUI(page, viewerEmail);

      await page.goto(`/lists/${ownerList.id}`);
      await expect(page.getByText(/this page could not be found/i)).toBeVisible();

      await page.goto("/lists/00000000-0000-4000-8000-000000000000");
      await expect(page.getByText(/this page could not be found/i)).toBeVisible();

      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (viewerId) await admin.auth.admin.deleteUser(viewerId);
    }
  });

  test("Add/remove items via the cross-category picker scoped to the caller's own non-deleted items; a trashed member item hides from the list and reappears automatically on Restore", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let otherUserId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "lists-picker");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const gameItem = await insertItem(user, userId, { title: "Chrono Trigger" });
      const bookItem = await insertItem(user, userId, {
        title: "Dune",
        categorySlug: "books",
        subtypeName: "Fiction",
      });
      const trashedItem = await insertItem(user, userId, {
        title: "Already Trashed Item",
        deletedAt: new Date().toISOString(),
      });

      const { email: otherEmail, userId: otherUid } = await createAdminUser(
        admin,
        "lists-picker-other",
      );
      otherUserId = otherUid;
      const otherUser = await createSupabaseUserClient(otherEmail, TEST_PASSWORD);
      const otherItem = await insertItem(otherUser, otherUserId, { title: "Not My Item" });
      await otherUser.auth.signOut();

      await loginViaUI(page, email);
      await page.goto("/lists");
      await page.getByLabel("New list name").fill("Cross-category picker list");
      await page.getByRole("button", { name: /^create list$/i }).click();
      await rows(page).filter({ hasText: "Cross-category picker list" }).getByRole("link").click();
      await page.waitForURL("**/lists/*");

      // Picker: only this user's own non-deleted items, across BOTH
      // categories -- never a trashed item, never another user's item.
      const picker = page.getByLabel("Item");
      await expect(picker.locator(`option[value="${gameItem.itemId}"]`)).toHaveCount(1);
      await expect(picker.locator(`option[value="${bookItem.itemId}"]`)).toHaveCount(1);
      await expect(picker.locator(`option[value="${trashedItem.itemId}"]`)).toHaveCount(0);
      await expect(picker.locator(`option[value="${otherItem.itemId}"]`)).toHaveCount(0);

      // Add the game item first, then the book item -- member list displays
      // newest-added-first (added_at desc), so the book item ends up on top.
      await picker.selectOption(gameItem.itemId);
      await page.getByRole("button", { name: /^add to list$/i }).click();
      await expect(rows(page).filter({ hasText: "Chrono Trigger" })).toBeVisible();
      // Already-added item is excluded from further picker candidates.
      await expect(picker.locator(`option[value="${gameItem.itemId}"]`)).toHaveCount(0);

      await picker.selectOption(bookItem.itemId);
      await page.getByRole("button", { name: /^add to list$/i }).click();
      await expect(rows(page).filter({ hasText: "Dune" })).toBeVisible();

      const memberRows = rows(page);
      await expect(memberRows).toHaveCount(2);
      await expect(memberRows.nth(0)).toContainText("Dune");
      await expect(memberRows.nth(1)).toContainText("Chrono Trigger");

      // Remove the game item -- its own list_items row goes away, the item
      // itself is untouched, and it reappears as a picker candidate.
      await memberRows
        .filter({ hasText: "Chrono Trigger" })
        .getByRole("button", { name: /^remove$/i })
        .click();
      await expect(rows(page).filter({ hasText: "Chrono Trigger" })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(picker.locator(`option[value="${gameItem.itemId}"]`)).toHaveCount(1);

      const { data: gameItemRow } = await user
        .from("items")
        .select("id")
        .eq("id", gameItem.itemId)
        .maybeSingle();
      expect(gameItemRow).not.toBeNull();

      // Trash the remaining member item (Dune) via the real Delete control
      // on its detail page -- it must disappear from the list's display...
      await page.goto(`/${bookItem.categorySlug}/${bookItem.itemId}`);
      await page.getByRole("button", { name: /^delete$/i }).click();
      await page.getByRole("button", { name: /^confirm$/i }).click();
      await page.waitForURL(`**/${bookItem.categorySlug}`, { timeout: 15_000 });

      const { data: listRow } = await user
        .from("lists")
        .select("id")
        .eq("name", "Cross-category picker list")
        .single();
      if (!listRow) throw new Error("list not found");
      await page.goto(`/lists/${listRow.id}`);
      await expect(page.getByText(/this list has no items yet/i)).toBeVisible();
      await expect(page.getByText("Dune")).toHaveCount(0);

      // ...but its list_items row is NOT deleted, only hidden from display.
      const { data: hiddenMemberRow } = await user
        .from("list_items")
        .select("item_id")
        .eq("list_id", listRow.id)
        .eq("item_id", bookItem.itemId)
        .maybeSingle();
      expect(hiddenMemberRow).not.toBeNull();

      // Restore it from Trash -- reappears in the list automatically, no
      // action needed on the list page itself.
      await page.goto("/trash");
      await page
        .locator("main")
        .getByRole("listitem")
        .filter({ hasText: "Dune" })
        .getByRole("button", { name: /^restore$/i })
        .click();
      await expect(page.getByText("Dune")).toHaveCount(0, { timeout: 15_000 });

      await page.goto(`/lists/${listRow.id}`);
      await expect(page.getByText("Dune")).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
      if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
    }
  });

  test("RLS blocks a cross-user attack on lists/list_items writes, independent of the app's own ownership checks", async () => {
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;

    try {
      const { email: ownerEmail, userId: ownerUid } = await createAdminUser(
        admin,
        "lists-rls-owner",
      );
      ownerId = ownerUid;
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { data: ownerList } = await owner
        .from("lists")
        .insert({ user_id: ownerId, name: "Owner's list" })
        .select("id")
        .single();
      if (!ownerList) throw new Error("failed to seed owner's list");
      const { itemId: ownerItemId } = await insertItem(owner, ownerId, {
        title: "Owner's item",
      });

      const { email: attackerEmail, userId: attackerUid } = await createAdminUser(
        admin,
        "lists-rls-attacker",
      );
      attackerId = attackerUid;
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);
      const { itemId: attackerItemId } = await insertItem(attacker, attackerId, {
        title: "Attacker's item",
      });

      // lists_update_own: attacker can't rename the owner's list.
      const { data: renameAttempt, error: renameError } = await attacker
        .from("lists")
        .update({ name: "Hijacked" })
        .eq("id", ownerList.id)
        .select("id");
      expect(renameError).toBeNull();
      expect(renameAttempt).toEqual([]);

      // lists_delete_own: attacker can't delete the owner's list.
      const { data: deleteAttempt, error: deleteError } = await attacker
        .from("lists")
        .delete()
        .eq("id", ownerList.id)
        .select("id");
      expect(deleteError).toBeNull();
      expect(deleteAttempt).toEqual([]);

      // list_items_insert_own: attacker can't add their own item into the
      // owner's list (the policy's first exists-check requires the parent
      // list to belong to the caller).
      const { error: addForeignItemError } = await attacker
        .from("list_items")
        .insert({ list_id: ownerList.id, item_id: attackerItemId });
      expect(addForeignItemError).not.toBeNull();

      // Owner adds their own item to their own list for the next checks.
      const { error: ownerAddError } = await owner
        .from("list_items")
        .insert({ list_id: ownerList.id, item_id: ownerItemId });
      expect(ownerAddError).toBeNull();

      // list_items_delete_own: attacker can't remove the owner's member row.
      const { data: removeAttempt, error: removeError } = await attacker
        .from("list_items")
        .delete()
        .eq("list_id", ownerList.id)
        .eq("item_id", ownerItemId)
        .select();
      expect(removeError).toBeNull();
      expect(removeAttempt).toEqual([]);

      const { data: stillThere } = await owner
        .from("list_items")
        .select("item_id")
        .eq("list_id", ownerList.id)
        .eq("item_id", ownerItemId)
        .maybeSingle();
      expect(stillThere).not.toBeNull();

      const { data: listStillThere } = await owner
        .from("lists")
        .select("name")
        .eq("id", ownerList.id)
        .single();
      expect(listStillThere?.name).toBe("Owner's list");

      await owner.from("lists").delete().eq("id", ownerList.id);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
