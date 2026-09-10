import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #35 (Remove/delete an item's cover image):
// the real removal flow through removeCoverAction (lib/actions/covers.ts)
// against the live Supabase project, including live verification that both
// the storage object AND the item_images row are actually gone (not just
// that the UI stopped showing a cover) -- unit coverage
// (src/lib/actions/covers.test.ts) already exercises the no-op and
// storage-failure branches with mocks; this file is for what only a real
// browser + real storage/DB round trip can confirm.
//
// Same account-creation/cleanup shape as e2e/cover-upload.spec.ts: disposable
// accounts created via the Supabase Admin API (not the public /register UI,
// which is subject to Auth's signup rate limit), logged in through the real
// UI, always deleted in a `finally` block.

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

async function insertGamesRpgItem(
  user: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  userId: string,
  title: string,
) {
  const { data: category } = await user
    .from("categories")
    .select("id, slug")
    .eq("slug", "games")
    .single();
  if (!category) throw new Error("games category not found");

  const { data: subtype } = await user
    .from("subtypes")
    .select("id")
    .eq("category_id", category.id)
    .eq("name", "RPG")
    .single();
  if (!subtype) throw new Error("RPG subtype not found");

  const { data: item } = await user
    .from("items")
    .insert({ user_id: userId, category_id: category.id, subtype_id: subtype.id, title, status: "planned" })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Cover image removal (issue #35)", () => {
  test("no 'Remove cover' control when the item has no cover; after uploading one, removing it deletes both the storage object and the item_images row and reverts the UI to the no-cover state", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverremove-basic");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Remove Cover Item");
      storagePath = `${userId}/${itemId}/cover`;

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      // No Remove control before there's ever a cover.
      await expect(page.getByRole("button", { name: /^remove cover$/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();

      await page
        .getByLabel("Cover image", { exact: true })
        .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });

      const coverImg = page.getByRole("img", { name: "Cover for Remove Cover Item" });
      await expect(coverImg).toBeVisible({ timeout: 15_000 });
      const removeButton = page.getByRole("button", { name: /^remove cover$/i });
      await expect(removeButton).toBeVisible();

      // Sanity check before removing: the storage object and item_images
      // row this test is about to assert are gone actually exist first.
      const { data: beforeImages } = await user
        .from("item_images")
        .select("id")
        .eq("item_id", itemId);
      expect(beforeImages).toHaveLength(1);
      const { data: beforeListing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(beforeListing ?? []).toHaveLength(1);

      await removeButton.click();

      // Instant, no confirmation panel -- removeCoverAction redirects back
      // to this same route (its target URL never changes, so there's
      // nothing for waitForURL to catch), forcing a fresh server render
      // with the cover gone: no broken-image icon, no placeholder box
      // (hidden via hideWhenEmpty), button back to reading "Upload cover".
      await expect(page.getByRole("img", { name: "Cover for Remove Cover Item" })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(
        page.getByRole("img", { name: /no cover image for remove cover item/i }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^remove cover$/i })).toHaveCount(0);

      // Live verification, not just trusting the UI: both the item_images
      // row AND the storage object are actually gone.
      const { data: afterImages } = await user
        .from("item_images")
        .select("id")
        .eq("item_id", itemId);
      expect(afterImages ?? []).toHaveLength(0);
      const { data: afterListing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(afterListing ?? []).toHaveLength(0);

      // Card view reflects the removal on next load too (no separate
      // client-side sync needed there, per #35's acceptance criteria).
      await page.goto(`/${categorySlug}`);
      await page.getByRole("button", { name: "Card" }).click();
      const card = page.getByRole("link", { name: /Remove Cover Item/ });
      await expect(card.getByRole("img", { name: "Cover for Remove Cover Item" })).toHaveCount(0);

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("cross-user protection: RLS blocks an attacker from removing another user's cover object directly, independent of removeCoverAction's own ownership check", async () => {
    // No `page` fixture needed -- direct-storage attack, same shape as
    // cover-upload.spec.ts's own cross-user test.
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email: ownerEmail, userId: ownerUid } = await createAdminUser(
        admin,
        "coverremove-rls-owner",
      );
      ownerId = ownerUid;
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { itemId } = await insertGamesRpgItem(owner, ownerId, "Owner-Only Cover Item");

      storagePath = `${ownerId}/${itemId}/cover`;
      const { error: uploadError } = await owner.storage
        .from("covers")
        .upload(storagePath, ONE_PIXEL_PNG, { contentType: "image/png" });
      if (uploadError) throw uploadError;
      const { error: insertError } = await owner
        .from("item_images")
        .insert({ item_id: itemId, storage_path: storagePath, is_cover: true });
      if (insertError) throw insertError;

      const { email: attackerEmail, userId: attackerUid } = await createAdminUser(
        admin,
        "coverremove-rls-attacker",
      );
      attackerId = attackerUid;
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      // covers_delete_own's `using` clause scopes DELETE to paths whose
      // first segment is the caller's own auth.uid() -- unlike INSERT,
      // Storage's RLS-filtered bulk delete doesn't surface a policy
      // violation as an error here, it just silently matches zero rows
      // (the owner's object isn't among the attacker's own). So the real
      // assertion is that the object survives, not that an error came
      // back.
      await attacker.storage.from("covers").remove([storagePath]);

      // The owner's cover is untouched by the attacker's attempt.
      const { data: ownerImages } = await owner
        .from("item_images")
        .select("id")
        .eq("item_id", itemId);
      expect(ownerImages).toHaveLength(1);
      const { data: listing } = await owner.storage.from("covers").list(`${ownerId}/${itemId}`);
      expect(listing).toHaveLength(1);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
