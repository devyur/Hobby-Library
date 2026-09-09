import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #21 (File attachments on an item): the real
// always-interactive Attachments section + uploadAttachmentAction/
// removeAttachmentAction Server Actions, and the `attachments` Storage
// bucket, against the live project. Server-side extension/size/count
// rejection and the ownership/"not found" check are already covered
// directly (unmocked validation helpers, mocked Supabase client) by
// lib/validation/attachments.test.ts and lib/actions/attachments.test.ts --
// what only a live browser + real project can prove is covered here
// instead: the section works without ever clicking "Edit", a real upload
// lands one Storage object + one item_attachments row, download actually
// retrieves the original bytes under the original filename, removal leaves
// neither orphaned, the bucket's own file_size_limit/allowed_mime_types
// reject a bad upload independent of the app's own checks, and RLS truly
// blocks a cross-user attachment write/read.
//
// Test accounts are created directly via the Supabase Admin API
// (auth.admin.createUser, email pre-confirmed) rather than through the
// public /register flow, same as e2e/item-links.spec.ts and
// e2e/cover-upload.spec.ts, to avoid adding to that endpoint's signup rate
// limit. Every account/storage object created here is cleaned up in a
// `finally` block.

async function createTestUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`failed to create test user: ${error?.message}`);
  return data.user.id;
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

const attachmentsSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Attachments" }) });

test.describe("File attachments on an item (issue #21)", () => {
  test("upload (.md with an unreliable File.type) appears without a reload, downloads under its real filename, and remove deletes both the storage object and the DB row", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    const email = randomTestEmail("attach-flow");
    let userId: string | null = null;

    try {
      userId = await createTestUser(admin, email);
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Attachments Flow Test");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      const section = attachmentsSection(page);
      // Still in view mode -- no Status <select> present.
      await expect(page.getByLabel("Status")).toHaveCount(0);
      await expect(section.getByText("No attachments yet")).toBeVisible();

      // .md files commonly arrive with an empty/unregistered File.type in
      // real browsers -- Playwright's setInputFiles lets us set mimeType
      // explicitly to reproduce that.
      await section.locator("input[type=file]").setInputFiles({
        name: "notes.md",
        mimeType: "",
        buffer: Buffer.from("# Hello world"),
      });

      await expect(section.getByText("notes.md")).toBeVisible({ timeout: 15_000 });
      await expect(section.getByText("No attachments yet")).toHaveCount(0);
      await expect(page.getByLabel("Status")).toHaveCount(0);

      // Exactly one row, canonical MIME type derived from the .md
      // extension (never the empty File.type), and a real Storage object
      // at the expected id-keyed path.
      const { data: rows } = await user
        .from("item_attachments")
        .select("id, storage_path, filename, mime_type, size_bytes")
        .eq("item_id", itemId);
      expect(rows).toHaveLength(1);
      const row = rows![0];
      expect(row.filename).toBe("notes.md");
      expect(row.mime_type).toBe("text/markdown");
      expect(row.storage_path).toBe(`${userId}/${itemId}/${row.id}`);

      const { data: listing } = await user.storage.from("attachments").list(`${userId}/${itemId}`);
      expect(listing).toHaveLength(1);

      // Download link resolves a real signed URL that returns the original
      // bytes -- fetch it directly rather than driving a browser download.
      const downloadHref = await section.getByRole("link", { name: "Download" }).getAttribute("href");
      expect(downloadHref).toBeTruthy();
      const downloadResponse = await page.request.get(downloadHref!);
      expect(downloadResponse.ok()).toBe(true);
      expect(await downloadResponse.text()).toBe("# Hello world");
      // download=filename query param is what makes the browser save under
      // the real name instead of the opaque storage path segment.
      expect(downloadHref).toContain("download=notes.md");

      // Remove -- updates immediately, no reload needed.
      await page.getByRole("button", { name: "Remove notes.md" }).click();
      await expect(section.getByText("notes.md")).toHaveCount(0);
      await expect(section.getByText("No attachments yet")).toBeVisible({ timeout: 15_000 });

      // Neither the row nor the storage object survives -- nothing
      // orphaned in either place.
      await expect
        .poll(
          async () => {
            const { data } = await user.from("item_attachments").select("id").eq("item_id", itemId);
            return data?.length ?? 0;
          },
          { timeout: 15_000 },
        )
        .toBe(0);
      const { data: listingAfterRemove } = await user.storage
        .from("attachments")
        .list(`${userId}/${itemId}`);
      expect(listingAfterRemove ?? []).toHaveLength(0);

      // The item itself was never touched by any of this.
      const { data: itemRow } = await user.from("items").select("status, rating").eq("id", itemId).single();
      expect(itemRow?.status).toBe("planned");
      expect(itemRow?.rating).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a disallowed extension and an oversized file are both rejected client-side with zero writes", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    const email = randomTestEmail("attach-reject");
    let userId: string | null = null;

    try {
      userId = await createTestUser(admin, email);
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Reject Test Item");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);
      const section = attachmentsSection(page);

      await section.locator("input[type=file]").setInputFiles({
        name: "malware.exe",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("not allowed"),
      });
      await expect(page.getByText(/\.txt, \.md, or \.pdf/i)).toBeVisible();

      await section.locator("input[type=file]").setInputFiles({
        name: "big.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1024, "a"),
      });
      await expect(page.getByText(/2 mb or smaller/i)).toBeVisible();

      await expect(section.getByText("No attachments yet")).toBeVisible();
      const { data: rows } = await user.from("item_attachments").select("id").eq("item_id", itemId);
      expect(rows ?? []).toHaveLength(0);
      const { data: listing } = await user.storage.from("attachments").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("the 11th attachment is rejected: upload control shows a disabled/explanatory state instead of erroring on submit", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const admin = createSupabaseAdminClient();
    const email = randomTestEmail("attach-cap");
    let userId: string | null = null;
    let seededPaths: string[] = [];

    try {
      userId = await createTestUser(admin, email);
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Cap Test Item");

      // Seed 10 attachments directly (storage + DB) rather than uploading
      // through the UI 10 times -- faster, and the upload flow itself is
      // already covered by the first test.
      for (let i = 0; i < 10; i++) {
        const path = `${userId}/${itemId}/seed-${i}`;
        const { error: uploadError } = await user.storage
          .from("attachments")
          .upload(path, Buffer.from(`file ${i}`), { contentType: "text/plain" });
        if (uploadError) throw uploadError;
        seededPaths.push(path);
        const { error: insertError } = await user.from("item_attachments").insert({
          item_id: itemId,
          storage_path: path,
          filename: `seed-${i}.txt`,
          mime_type: "text/plain",
          size_bytes: 6,
        });
        if (insertError) throw insertError;
      }

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);
      const section = attachmentsSection(page);

      await expect(section.getByText(/maximum allowed/i)).toBeVisible();
      await expect(section.locator("input[type=file]")).toBeDisabled();
      await expect(section.getByRole("button", { name: "Add attachment" })).toBeDisabled();

      // Confirm the count really is still exactly 10 (no accidental extra
      // write from page load itself).
      const { data: rows } = await user.from("item_attachments").select("id").eq("item_id", itemId);
      expect(rows).toHaveLength(10);

      await user.auth.signOut();
    } finally {
      if (userId && seededPaths.length > 0) {
        await admin.storage.from("attachments").remove(seededPaths);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("storage-layer defense-in-depth: the attachments bucket itself rejects a disallowed MIME type and an oversized file, independent of the app's own checks", async () => {
    const admin = createSupabaseAdminClient();
    const email = randomTestEmail("attach-bucketlimits");
    let userId: string | null = null;

    try {
      userId = await createTestUser(admin, email);
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const itemId = "11111111-1111-4111-8111-111111111111"; // arbitrary -- only the path prefix matters to storage policy/limits, no items row needed.
      const path = `${userId}/${itemId}/attach-direct`;

      const { error: wrongTypeError } = await user.storage
        .from("attachments")
        .upload(path, Buffer.from("<html></html>"), { contentType: "text/html" });
      expect(wrongTypeError).not.toBeNull();

      const oversized = Buffer.alloc(2 * 1024 * 1024 + 1024, "a");
      const { error: oversizedError } = await user.storage
        .from("attachments")
        .upload(path, oversized, { contentType: "text/plain" });
      expect(oversizedError).not.toBeNull();

      const { data: listing } = await user.storage.from("attachments").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("cross-user protection: RLS blocks an attacker from reading, inserting, or deleting another user's attachments, and from writing into their storage path", async () => {
    const admin = createSupabaseAdminClient();
    const ownerEmail = randomTestEmail("attach-rls-owner");
    const attackerEmail = randomTestEmail("attach-rls-attacker");
    let ownerId: string | null = null;
    let attackerId: string | null = null;
    let ownerPath: string | null = null;

    try {
      ownerId = await createTestUser(admin, ownerEmail);
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { itemId } = await insertGamesRpgItem(owner, ownerId, "RLS Owner Attachment Item");

      ownerPath = `${ownerId}/${itemId}/owner-file`;
      const { error: seedUploadError } = await owner.storage
        .from("attachments")
        .upload(ownerPath, Buffer.from("owner content"), { contentType: "text/plain" });
      if (seedUploadError) throw seedUploadError;
      const { data: ownerRow, error: seedInsertError } = await owner
        .from("item_attachments")
        .insert({
          item_id: itemId,
          storage_path: ownerPath,
          filename: "owner-file.txt",
          mime_type: "text/plain",
          size_bytes: 13,
        })
        .select("id")
        .single();
      if (seedInsertError || !ownerRow) throw seedInsertError ?? new Error("seed insert failed");

      attackerId = await createTestUser(admin, attackerEmail);
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      // attachments_insert_own: attacker can't write into the owner's path.
      const { error: storageInsertError } = await attacker.storage
        .from("attachments")
        .upload(`${ownerId}/${itemId}/attacker-file`, Buffer.from("attack"), {
          contentType: "text/plain",
        });
      expect(storageInsertError).not.toBeNull();

      // attachments_select_own: attacker can't read the owner's object.
      const { error: downloadError } = await attacker.storage.from("attachments").download(ownerPath);
      expect(downloadError).not.toBeNull();

      // item_attachments_insert_own: attacker can't insert a row scoped to
      // the owner's item.
      const { data: spoofed, error: spoofError } = await attacker
        .from("item_attachments")
        .insert({
          item_id: itemId,
          storage_path: `${ownerId}/${itemId}/spoofed`,
          filename: "spoofed.txt",
          mime_type: "text/plain",
          size_bytes: 1,
        })
        .select();
      expect(spoofError).not.toBeNull();
      expect(spoofed).toBeNull();

      // item_attachments_delete_own: attacker can't delete the owner's row.
      const { data: deleted, error: deleteError } = await attacker
        .from("item_attachments")
        .delete()
        .eq("id", ownerRow.id)
        .select();
      expect(deleteError).toBeNull();
      expect(deleted).toEqual([]);

      const { data: stillThere } = await owner
        .from("item_attachments")
        .select("id")
        .eq("id", ownerRow.id)
        .maybeSingle();
      expect(stillThere?.id).toBe(ownerRow.id);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId && ownerPath) {
        await admin.storage.from("attachments").remove([ownerPath]);
      }
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
