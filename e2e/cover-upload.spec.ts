import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #19 (Cover image upload): the real
// upload/replace flow through uploadCoverAction (lib/actions/covers.ts),
// including actual file uploads via Playwright's file input handling, and
// live verification of the two layers of defense-in-depth this issue adds
// (the Server Action's own type/size checks, and the `covers` bucket's new
// file_size_limit/allowed_mime_types from migration
// 20260909130000_set_covers_bucket_limits.sql) against the real Supabase
// project.
//
// Account creation: unlike other e2e specs (which register every account
// through the public /register UI), this file creates its disposable
// accounts via the Supabase Admin API (auth.admin.createUser) and only logs
// in through the UI -- the admin API isn't subject to Supabase Auth's
// public signup rate limit, which recent issues' heavy e2e testing has been
// exhausting. Every account/storage object created here is still cleaned up
// in a `finally` block, same as every other spec.

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

// Two distinct 1x1 PNGs (red, then blue) -- the "replace" test uploads one
// then the other and checks the storage object's actual bytes changed, not
// just that a request was sent.
const ONE_PIXEL_PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const ONE_PIXEL_PNG_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const OVERSIZED_PNG = Buffer.alloc(5 * 1024 * 1024 + 1024, 0);

test.describe("Cover image upload (issue #19)", () => {
  test("no-cover placeholder renders beforehand; a valid upload appears immediately on the detail page and in the category Card view", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverupload-fresh");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "No Cover Yet");
      storagePath = `${userId}/${itemId}/cover`;

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await expect(
        page.getByRole("img", { name: /no cover image for no cover yet/i }),
      ).toBeVisible();
      const uploadButton = page.getByRole("button", { name: /^upload cover$/i });
      await expect(uploadButton).toBeVisible();

      await page
        .getByLabel("Cover image", { exact: true })
        .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG_RED });

      await expect(page.getByRole("img", { name: "Cover for No Cover Yet" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: /^replace cover$/i })).toBeVisible();

      // Exactly one item_images row, at the fixed extension-less path.
      const { data: images } = await user
        .from("item_images")
        .select("id, storage_path, is_cover")
        .eq("item_id", itemId);
      expect(images).toHaveLength(1);
      expect(images?.[0].is_cover).toBe(true);
      expect(images?.[0].storage_path).toBe(`${userId}/${itemId}/cover`);

      // Same cover shows up in the category's Card view, not just the
      // detail page.
      await page.goto(`/${categorySlug}`);
      await page.getByRole("button", { name: "Card" }).click();
      const card = page.getByRole("link", { name: /No Cover Yet/ });
      await expect(card.getByRole("img", { name: "Cover for No Cover Yet" })).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("replacing an existing cover leaves exactly one item_images row and overwrites the same storage object in place -- no orphan, not duplicated", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverupload-replace");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Replace Cover Item");

      storagePath = `${userId}/${itemId}/cover`;
      const { error: uploadError } = await user.storage
        .from("covers")
        .upload(storagePath, ONE_PIXEL_PNG_RED, { contentType: "image/png" });
      if (uploadError) throw uploadError;
      const { data: firstImage, error: insertError } = await user
        .from("item_images")
        .insert({ item_id: itemId, storage_path: storagePath, is_cover: true })
        .select("id")
        .single();
      if (insertError || !firstImage) throw insertError ?? new Error("seed insert failed");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      const coverImg = page.getByRole("img", { name: "Cover for Replace Cover Item" });
      await expect(coverImg).toBeVisible();
      const oldSrc = await coverImg.getAttribute("src");

      await page
        .getByLabel("Cover image", { exact: true })
        .setInputFiles({ name: "cover2.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG_BLUE });

      await expect
        .poll(async () => coverImg.getAttribute("src"), { timeout: 15_000 })
        .not.toBe(oldSrc);

      // Still exactly one row, same row (same id), same storage_path --
      // never a second is_cover=true row, never zero.
      const { data: images } = await user
        .from("item_images")
        .select("id, storage_path, is_cover")
        .eq("item_id", itemId);
      expect(images).toHaveLength(1);
      expect(images?.[0].id).toBe(firstImage.id);
      expect(images?.[0].storage_path).toBe(storagePath);

      // The storage object itself was actually overwritten with the new
      // bytes -- not skipped, not a second object under the same folder.
      const { data: downloaded, error: downloadError } = await user.storage
        .from("covers")
        .download(storagePath);
      if (downloadError || !downloaded) throw downloadError ?? new Error("download failed");
      const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
      expect(downloadedBytes.equals(ONE_PIXEL_PNG_BLUE)).toBe(true);
      expect(downloadedBytes.equals(ONE_PIXEL_PNG_RED)).toBe(false);

      const { data: listing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(listing).toHaveLength(1);

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a non-image file is rejected with a clear inline error; nothing is written to storage or item_images", async ({
    page,
  }) => {
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverupload-wrongtype");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Wrong Type Item");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await page.getByLabel("Cover image", { exact: true }).setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not an image"),
      });

      // getByRole("alert") alone also matches Next's own
      // #__next-route-announcer__ (role="alert", empty text) -- scope to
      // the error text itself instead.
      await expect(page.getByText(/jpg, png, or webp/i)).toBeVisible();
      // No navigation happened -- still the pre-upload control.
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();
      await expect(
        page.getByRole("img", { name: /no cover image for wrong type item/i }),
      ).toBeVisible();

      const { data: images } = await user.from("item_images").select("id").eq("item_id", itemId);
      expect(images).toHaveLength(0);
      const { data: listing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("an oversized image is rejected with a clear inline error; nothing is written to storage or item_images", async ({
    page,
  }) => {
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverupload-oversized");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Oversized Item");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await page.getByLabel("Cover image", { exact: true }).setInputFiles({
        name: "big.png",
        mimeType: "image/png",
        buffer: OVERSIZED_PNG,
      });

      // Same role="alert" ambiguity as the wrong-type test above -- scope to
      // the error text itself.
      await expect(page.getByText(/5 mb or smaller/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();

      const { data: images } = await user.from("item_images").select("id").eq("item_id", itemId);
      expect(images).toHaveLength(0);
      const { data: listing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("storage-layer defense-in-depth: the covers bucket itself rejects a disallowed MIME type and an oversized file, independent of the app's own checks", async () => {
    // No `page` fixture needed -- this exercises the `covers` bucket
    // directly against the live project, not through the browser/UI.
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverupload-bucketlimits");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const itemId = "11111111-1111-4111-8111-111111111111"; // arbitrary -- only the path prefix matters to storage policy/limits, no items row needed.
      const path = `${userId}/${itemId}/cover`;

      const { error: wrongTypeError } = await user.storage
        .from("covers")
        .upload(path, Buffer.from("not an image"), { contentType: "text/plain" });
      expect(wrongTypeError).not.toBeNull();

      const { error: oversizedError } = await user.storage
        .from("covers")
        .upload(path, OVERSIZED_PNG, { contentType: "image/png" });
      expect(oversizedError).not.toBeNull();

      const { data: listing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("cross-user protection: RLS blocks an attacker from uploading directly into another user's item path or inserting an item_images row for it", async () => {
    // No `page` fixture needed -- direct-DB/storage attack, independent of
    // uploadCoverAction's own ownership check.
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;

    try {
      const { email: ownerEmail, userId: ownerUid } = await createAdminUser(
        admin,
        "coverupload-rls-owner",
      );
      ownerId = ownerUid;
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { itemId } = await insertGamesRpgItem(owner, ownerId, "Owner-Only Cover Item");

      const { email: attackerEmail, userId: attackerUid } = await createAdminUser(
        admin,
        "coverupload-rls-attacker",
      );
      attackerId = attackerUid;
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      const victimPath = `${ownerId}/${itemId}/cover`;

      // covers_insert_own only allows a path whose first segment is the
      // caller's own auth.uid() -- the attacker's own uid, not the owner's.
      const { error: storageError } = await attacker.storage
        .from("covers")
        .upload(victimPath, ONE_PIXEL_PNG_RED, { contentType: "image/png" });
      expect(storageError).not.toBeNull();

      // item_images_insert_own requires the referenced item to belong to
      // the caller -- the attacker doesn't own this item, so RLS rejects
      // the insert outright (a policy violation error on INSERT, unlike a
      // silently-empty result on SELECT/UPDATE).
      const { error: dbError } = await attacker
        .from("item_images")
        .insert({ item_id: itemId, storage_path: victimPath, is_cover: true });
      expect(dbError).not.toBeNull();

      const { data: ownerImages } = await owner
        .from("item_images")
        .select("id")
        .eq("item_id", itemId);
      expect(ownerImages ?? []).toHaveLength(0);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
