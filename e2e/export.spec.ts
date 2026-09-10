import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #29 (Export): GET /api/export against the
// real project, per AGENTS.md's guidance to exercise real cookie-based auth
// through Playwright rather than a hand-built fetch/curl against a route
// that depends on the session cookie. What only a live browser + real
// project can prove is covered here rather than in the mocked unit tests
// (lib/queries/export.test.ts): a genuinely unauthenticated request (no
// session cookie at all) gets 401, the download headers are correct, and --
// most importantly -- the actual RLS-backed data (another user's item never
// leaking into this export) rather than a mocked query result.
//
// Test accounts are created via the Supabase Admin API
// (auth.admin.createUser), same as e2e/trash.spec.ts and
// e2e/lists.spec.ts, to avoid adding to /register's signup rate limit.
// Cleanup deletes only the admin-created users -- every row this spec
// inserts (items, tags, lists, list_items, ...) cascades away via its
// `on delete cascade` FK to auth.users, same reliance e2e/lists.spec.ts and
// e2e/trash.spec.ts already document.

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

test.describe("Export (issue #29)", () => {
  test("an unauthenticated request gets 401 with no library data in the body", async ({
    request,
  }) => {
    // The plain `request` fixture (not `page.request`) carries no session
    // cookie -- a genuinely unauthenticated request, not just a logged-out
    // page.
    const response = await request.get("/api/export");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.items).toBeUndefined();
    expect(body.lists).toBeUndefined();
  });

  test("a signed-in user downloads their own active library as JSON: correct headers, exact shape, trash excluded, dangling list membership dropped, cross-user isolation", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userAId: string | null = null;
    let userBId: string | null = null;

    try {
      // User B: a decoy item that must never appear in A's export.
      const { email: emailB, userId: idB } = await createAdminUser(admin, "export-userB");
      userBId = idB;
      const userB = await createSupabaseUserClient(emailB, TEST_PASSWORD);
      const { category: catB, subtype: subB } = await categoryAndSubtype(userB, "games", "RPG");
      await userB.from("items").insert({
        user_id: userBId,
        category_id: catB.id,
        subtype_id: subB.id,
        title: "Should Never Appear In A's Export",
        status: "planned",
      });

      const { email, userId: idA } = await createAdminUser(admin, "export-userA");
      userAId = idA;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { category, subtype } = await categoryAndSubtype(user, "games", "RPG");

      // The kept item -- every relation populated.
      const { data: keptItem } = await user
        .from("items")
        .insert({
          user_id: userAId,
          category_id: category.id,
          subtype_id: subtype.id,
          title: "Mass Effect 2",
          status: "completed",
          priority: "high",
          rating: 9,
          notes: "great",
          review: "loved it",
        })
        .select("id")
        .single();
      if (!keptItem) throw new Error("insert kept item failed");

      const { data: predefinedTag } = await user
        .from("tags")
        .select("id, name")
        .is("user_id", null)
        .limit(1)
        .single();
      if (!predefinedTag) throw new Error("no predefined tag seed found");
      const { data: customTag } = await user
        .from("tags")
        .insert({ name: "export-e2e-custom-tag", user_id: userAId })
        .select("id, name")
        .single();
      if (!customTag) throw new Error("insert custom tag failed");
      await user.from("item_tags").insert([
        { item_id: keptItem.id, tag_id: predefinedTag.id },
        { item_id: keptItem.id, tag_id: customTag.id },
      ]);

      await user
        .from("item_links")
        .insert({ item_id: keptItem.id, url: "https://example.com/me2", label: "Store page" });
      await user.from("item_images").insert({
        item_id: keptItem.id,
        storage_path: `${userAId}/${keptItem.id}/cover`,
        is_cover: true,
        sort_order: 0,
      });
      await user.from("item_attachments").insert({
        item_id: keptItem.id,
        storage_path: `${userAId}/${keptItem.id}/attach`,
        filename: "notes.pdf",
        mime_type: "application/pdf",
        size_bytes: 111,
      });

      // A trashed item -- must be excluded entirely.
      const { data: trashedItem } = await user
        .from("items")
        .insert({
          user_id: userAId,
          category_id: category.id,
          subtype_id: subtype.id,
          title: "Trashed Item",
          status: "planned",
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!trashedItem) throw new Error("insert trashed item failed");

      // A list referencing both -- the trashed membership must be dropped
      // from item_ids, not left dangling.
      const { data: list } = await user
        .from("lists")
        .insert({ user_id: userAId, name: "Export Test List" })
        .select("id")
        .single();
      if (!list) throw new Error("insert list failed");
      await user.from("list_items").insert([
        { list_id: list.id, item_id: keptItem.id, sort_order: 0 },
        { list_id: list.id, item_id: trashedItem.id, sort_order: 1 },
      ]);

      await loginViaUI(page, email);

      const response = await page.request.get("/api/export");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/json");
      const today = new Date().toISOString().slice(0, 10);
      expect(response.headers()["content-disposition"]).toBe(
        `attachment; filename="hobby-library-export-${today}.json"`,
      );

      const body = await response.json();

      // Exactly the four documented top-level keys, nothing else.
      expect(Object.keys(body).sort()).toEqual(["exported_at", "items", "lists", "schema_version"]);
      expect(body.schema_version).toBe(1);
      expect(typeof body.exported_at).toBe("string");

      // Cross-user isolation + trash exclusion: exactly one item, the kept one.
      expect(body.items).toHaveLength(1);
      const exported = body.items[0];
      expect(exported.id).toBe(keptItem.id);
      expect(exported.title).toBe("Mass Effect 2");
      expect(exported.category).toBe("games");
      expect(exported.subtype).toEqual({ name: "RPG", is_custom: false });
      expect(exported.status).toBe("completed");
      expect(exported.priority).toBe("high");
      expect(exported.rating).toBe(9);
      expect(exported.notes).toBe("great");
      expect(exported.review).toBe("loved it");
      expect(typeof exported.created_at).toBe("string");
      expect(typeof exported.updated_at).toBe("string");

      const tagNames = exported.tags.map((t: { name: string; is_custom: boolean }) => t.name).sort();
      expect(tagNames).toEqual([customTag.name, predefinedTag.name].sort());
      expect(
        exported.tags.find((t: { name: string }) => t.name === customTag.name),
      ).toEqual({ name: customTag.name, is_custom: true });
      expect(
        exported.tags.find((t: { name: string }) => t.name === predefinedTag.name),
      ).toEqual({ name: predefinedTag.name, is_custom: false });

      expect(exported.links).toEqual([{ url: "https://example.com/me2", label: "Store page" }]);

      expect(exported.images).toHaveLength(1);
      expect(exported.images[0]).toMatchObject({ is_cover: true, sort_order: 0 });
      expect(typeof exported.images[0].storage_path).toBe("string");

      expect(exported.attachments).toHaveLength(1);
      expect(exported.attachments[0].filename).toBe("notes.pdf");
      expect(exported.attachments[0].mime_type).toBe("application/pdf");
      expect(exported.attachments[0].size_bytes).toBe(111);
      // Deliberately no storage_path on attachments, unlike images.
      expect(exported.attachments[0].storage_path).toBeUndefined();

      expect(body.items.some((item: { title: string }) => item.title === "Should Never Appear In A's Export")).toBe(
        false,
      );
      expect(body.items.some((item: { title: string }) => item.title === "Trashed Item")).toBe(false);

      // Dangling membership (the trashed item) dropped, kept item's id survives.
      expect(body.lists).toHaveLength(1);
      expect(body.lists[0].name).toBe("Export Test List");
      expect(body.lists[0].item_ids).toEqual([keptItem.id]);

      await user.auth.signOut();
    } finally {
      if (userAId) await admin.auth.admin.deleteUser(userAId);
      if (userBId) await admin.auth.admin.deleteUser(userBId);
    }
  });
});
