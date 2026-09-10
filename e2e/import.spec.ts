import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #30 (Import): the real upload flow through
// importLibraryAction (lib/actions/import.ts) via the Import form on
// /settings (ImportLibraryForm.tsx), per AGENTS.md's guidance to exercise
// real form/auth flows through Playwright rather than hand-built requests
// against a Server Action. Two things only a live browser + real project
// can prove, which the mocked unit tests (lib/actions/import.test.ts)
// can't: (1) a small fixture file uploaded through the actual <input
// type="file"> ends up as a real, visible item in the category library
// view, and (2) a genuine export -> import round trip (an account's real
// data exported via #29's live /api/export, then imported into a DIFFERENT
// account through this form) recreates items/tags/links/lists correctly
// against real RLS-scoped Supabase data, with list item_ids re-mapped to
// the new account's own new item ids and zero item_images/item_attachments
// rows created for the imported items.
//
// Test accounts are created via the Supabase Admin API
// (auth.admin.createUser), same as e2e/export.spec.ts/lists.spec.ts, to
// avoid adding to /register's signup rate limit. Cleanup deletes only the
// admin-created users -- every row either spec inserts cascades away via
// its `on delete cascade` FK to auth.users.

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

async function uploadFile(page: Page, filename: string, json: unknown) {
  await page
    .getByLabel("Export file", { exact: true })
    .setInputFiles({ name: filename, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
}

test.describe("Import (issue #30)", () => {
  test("uploading a small fixture file through the real form creates the item, visible in its category library view, with the success message reporting counts", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "import-fixture");
      userId = id;
      await loginViaUI(page, email);

      const fixture = {
        schema_version: 1,
        exported_at: "2024-01-01T00:00:00.000Z",
        items: [
          {
            id: "fixture-item-1",
            title: "Outer Wilds",
            category: "games",
            subtype: { name: "Adventure", is_custom: false },
            status: "planned",
            priority: null,
            rating: null,
            notes: null,
            review: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            completed_at: null,
            tags: [],
            links: [],
            images: [],
            attachments: [],
          },
        ],
        lists: [],
      };

      await page.goto("/settings");
      await uploadFile(page, "fixture-export.json", fixture);

      await expect(page.getByText(/imported 1 item and 0 lists/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/cover images and attachments are not restored/i)).toBeVisible();

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");
      await expect(page.getByText("Outer Wilds")).toBeVisible();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("malformed JSON and a schema_version mismatch are both rejected with a clear error and no item created", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "import-invalid");
      userId = id;
      await loginViaUI(page, email);
      await page.goto("/settings");

      await page
        .getByLabel("Export file", { exact: true })
        .setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{ not valid json") });
      await expect(page.getByText(/valid json/i)).toBeVisible({ timeout: 20_000 });

      await uploadFile(page, "wrong-version.json", {
        schema_version: 2,
        exported_at: "2024-01-01T00:00:00.000Z",
        items: [],
        lists: [],
      });
      await expect(page.getByText(/unsupported export file version/i)).toBeVisible({ timeout: 20_000 });

      // Neither rejected upload ever created a partial-success message.
      await expect(page.getByText(/^imported /i)).toHaveCount(0);
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a genuine export -> import round trip: real data exported from one account recreates correctly in a different account, with list item_ids re-mapped to the new items and no item_images/item_attachments written", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const admin = createSupabaseAdminClient();
    let sourceUserId: string | null = null;
    let destUserId: string | null = null;

    try {
      // --- Source account: seed real data with subtype/tags/link/list,
      // export it live via /api/export. ---
      const { email: sourceEmail, userId: sourceId } = await createAdminUser(admin, "import-src");
      sourceUserId = sourceId;
      const sourceUser = await createSupabaseUserClient(sourceEmail, TEST_PASSWORD);
      const { category, subtype } = await categoryAndSubtype(sourceUser, "games", "RPG");

      const { data: sourceItem } = await sourceUser
        .from("items")
        .insert({
          user_id: sourceUserId,
          category_id: category.id,
          subtype_id: subtype.id,
          title: "Round Trip Item",
          status: "completed",
          priority: "medium",
          rating: 7,
          notes: "n",
          review: "r",
        })
        .select("id")
        .single();
      if (!sourceItem) throw new Error("insert source item failed");

      const { data: predefinedTag } = await sourceUser
        .from("tags")
        .select("id, name")
        .is("user_id", null)
        .limit(1)
        .single();
      if (!predefinedTag) throw new Error("no predefined tag seed found");
      const customTagName = `import-e2e-custom-${Date.now()}`;
      const { data: customTag } = await sourceUser
        .from("tags")
        .insert({ name: customTagName, user_id: sourceUserId })
        .select("id, name")
        .single();
      if (!customTag) throw new Error("insert custom tag failed");
      await sourceUser.from("item_tags").insert([
        { item_id: sourceItem.id, tag_id: predefinedTag.id },
        { item_id: sourceItem.id, tag_id: customTag.id },
      ]);
      await sourceUser
        .from("item_links")
        .insert({ item_id: sourceItem.id, url: "https://example.com/rt", label: "Ref" });
      // A cover row -- must NOT be recreated on import.
      await sourceUser.from("item_images").insert({
        item_id: sourceItem.id,
        storage_path: `${sourceUserId}/${sourceItem.id}/cover`,
        is_cover: true,
        sort_order: 0,
      });

      const { data: sourceList } = await sourceUser
        .from("lists")
        .insert({ user_id: sourceUserId, name: "Round Trip List" })
        .select("id")
        .single();
      if (!sourceList) throw new Error("insert source list failed");
      await sourceUser
        .from("list_items")
        .insert({ list_id: sourceList.id, item_id: sourceItem.id, sort_order: 0 });

      await loginViaUI(page, sourceEmail);
      const exportResponse = await page.request.get("/api/export");
      expect(exportResponse.status()).toBe(200);
      const exportedData = await exportResponse.json();
      await sourceUser.auth.signOut();

      // --- Destination account: a DIFFERENT user, never touched the
      // source's data before now. Import the exported file through the
      // real form. ---
      const { email: destEmail, userId: destId } = await createAdminUser(admin, "import-dest");
      destUserId = destId;
      const destUser = await createSupabaseUserClient(destEmail, TEST_PASSWORD);

      await loginViaUI(page, destEmail);
      await page.goto("/settings");
      await uploadFile(page, "round-trip-export.json", exportedData);

      await expect(page.getByText(/imported 1 item and 1 list/i)).toBeVisible({ timeout: 20_000 });

      // The recreated item: same content, but a fresh id (never the
      // source's stale file id).
      const { data: newItem } = await destUser
        .from("items")
        .select("id, title, status, priority, rating, notes, review, category_id, subtype_id")
        .eq("user_id", destUserId)
        .eq("title", "Round Trip Item")
        .single();
      expect(newItem).not.toBeNull();
      expect(newItem!.id).not.toBe(sourceItem.id);
      expect(newItem!.status).toBe("completed");
      expect(newItem!.priority).toBe("medium");
      expect(newItem!.rating).toBe(7);
      expect(newItem!.notes).toBe("n");
      expect(newItem!.review).toBe("r");
      expect(newItem!.category_id).toBe(category.id);

      // Predefined tag matched (not duplicated -- same tags.id as the
      // predefined row), custom tag re-created as this user's OWN new
      // custom row (different id, same name, own user_id) -- never
      // attached to the source account's private custom tag id.
      const { data: newItemTags } = await destUser
        .from("item_tags")
        .select("tags(id, name, user_id)")
        .eq("item_id", newItem!.id);
      const tagRows = (newItemTags ?? []).map((row) => {
        const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
        return tag as { id: string; name: string; user_id: string | null };
      });
      expect(tagRows.find((t) => t.name === predefinedTag.name)).toEqual(
        expect.objectContaining({ id: predefinedTag.id, user_id: null }),
      );
      const newCustomTag = tagRows.find((t) => t.name === customTagName);
      expect(newCustomTag).toBeTruthy();
      expect(newCustomTag!.id).not.toBe(customTag.id);
      expect(newCustomTag!.user_id).toBe(destUserId);

      // Link recreated.
      const { data: newLinks } = await destUser
        .from("item_links")
        .select("url, label")
        .eq("item_id", newItem!.id);
      expect(newLinks).toEqual([{ url: "https://example.com/rt", label: "Ref" }]);

      // Cover metadata is NEVER recreated -- zero item_images rows for the
      // new item, even though the export file carried an images[] entry.
      const { data: newImages } = await destUser
        .from("item_images")
        .select("id")
        .eq("item_id", newItem!.id);
      expect(newImages).toEqual([]);
      const { data: newAttachments } = await destUser
        .from("item_attachments")
        .select("id")
        .eq("item_id", newItem!.id);
      expect(newAttachments).toEqual([]);

      // The list is recreated for the destination user, and its item_ids
      // are re-mapped to the NEW item's real id -- never the source
      // account's stale item id.
      const { data: newList } = await destUser
        .from("lists")
        .select("id, name")
        .eq("user_id", destUserId)
        .eq("name", "Round Trip List")
        .single();
      expect(newList).not.toBeNull();
      const { data: newListItems } = await destUser
        .from("list_items")
        .select("item_id")
        .eq("list_id", newList!.id);
      expect(newListItems).toEqual([{ item_id: newItem!.id }]);

      await destUser.auth.signOut();
    } finally {
      if (sourceUserId) await admin.auth.admin.deleteUser(sourceUserId);
      if (destUserId) await admin.auth.admin.deleteUser(destUserId);
    }
  });
});
