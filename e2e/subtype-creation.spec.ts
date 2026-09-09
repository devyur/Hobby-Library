import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #18 (Custom subtype creation): the real
// "+ Create new subtype…" affordance (SubtypePicker.tsx) + createSubtypeAction
// Server Action flow against the live project, from both the Full Add form
// (#14) and item edit's new Subtype control (#16 left it read-only; this
// issue adds it) -- including the two things unit coverage
// (lib/actions/subtypes.test.ts) can mock around but can't actually prove
// live: the new subtypes RLS policies (INSERT scoped to auth.uid(), SELECT
// scoped to predefined-or-own) and the category-scoped
// subtypes_category_lower_name_user_key unique index. Each test registers
// its own disposable account via the real UI and deletes it afterward, same
// convention as item-tags.spec.ts/item-edit.spec.ts.

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
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
    .insert({
      user_id: userId,
      category_id: category.id,
      subtype_id: subtype.id,
      title,
      status: "planned",
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

test.describe("Custom subtype creation (issue #18)", () => {
  test("Full Add: creating a new subtype attaches it to the Subtype picker immediately (no reload) and the item saves with it", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("subtype-fulladd");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      await page.goto("/add");
      await page.getByLabel("Title").fill("New Subtype Via Add");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype", { exact: true }).selectOption({ label: "+ Create new subtype…" });

      await page.getByLabel("New subtype name").fill("Immersive Sim");
      await page.getByRole("button", { name: "Create" }).click();

      // Selected immediately -- no page reload -- and the create UI closes.
      // Generous timeout: this waits on the real createSubtypeAction round
      // trip to the live project, not a local mock.
      await expect(page.getByLabel("New subtype name")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByLabel("Subtype", { exact: true })).toHaveValue(/.+/);
      await expect(
        page.getByLabel("Subtype", { exact: true }).locator("option", { hasText: "Immersive Sim" }),
      ).toHaveCount(1);

      await page.getByRole("button", { name: /^add item$/i }).click();
      await page.waitForURL(/\/games\/[0-9a-f-]+$/);
      await expect(page.getByText("Games · Immersive Sim")).toBeVisible();

      const { data: created } = await user
        .from("subtypes")
        .select("id, user_id, category_id")
        .eq("name", "Immersive Sim")
        .single();
      expect(created?.user_id).toBe(userId);

      const { data: item } = await user
        .from("items")
        .select("subtype_id")
        .eq("title", "New Subtype Via Add")
        .single();
      expect(item?.subtype_id).toBe(created?.id);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Item edit: Subtype is editable, and creating a new one from edit mode selects and saves it", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("subtype-itemedit");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(
        user,
        userId,
        "Edit Subtype Test",
      );

      await page.goto(`/${categorySlug}/${itemId}`);
      await expect(page.getByText("Games · RPG")).toBeVisible();

      await page.getByRole("button", { name: /^edit$/i }).click();
      const subtypeSelect = page.getByLabel("Subtype", { exact: true });
      await expect(subtypeSelect).toBeVisible();
      await expect(subtypeSelect).toHaveValue(/.+/); // pre-selected to the item's current (RPG) subtype

      await subtypeSelect.selectOption({ label: "+ Create new subtype…" });
      await page.getByLabel("New subtype name").fill("Tactics RPG");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByLabel("New subtype name")).toHaveCount(0, { timeout: 15_000 });

      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("Games · Tactics RPG")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("subtype_id, subtypes ( name )")
        .eq("id", itemId)
        .single();
      const subtype = Array.isArray(row?.subtypes) ? row.subtypes[0] : row?.subtypes;
      expect((subtype as { name?: string } | null)?.name).toBe("Tactics RPG");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("same-name-same-category dedup: creating a subtype that case-insensitively matches an existing predefined one attaches it instead of duplicating, and a same name in a different category is unaffected", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("subtype-dedup");
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
      const { data: predefinedRpg } = await user
        .from("subtypes")
        .select("id")
        .eq("category_id", gamesCategory.id)
        .is("user_id", null)
        .ilike("name", "rpg")
        .single();
      expect(predefinedRpg).not.toBeNull();
      const predefinedRpgId = predefinedRpg!.id as string;

      await page.goto("/add");
      await page.getByLabel("Title").fill("Dedup Test Item");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype", { exact: true }).selectOption({ label: "+ Create new subtype…" });
      // Padding + case variant of the existing predefined "RPG" -- typed
      // submit must attach the existing row, never create a duplicate.
      await page.getByLabel("New subtype name").fill("  rpg  ");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByLabel("New subtype name")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByLabel("Subtype", { exact: true })).toHaveValue(predefinedRpgId);

      await page.getByRole("button", { name: /^add item$/i }).click();
      await page.waitForURL(/\/games\/[0-9a-f-]+$/);

      const { data: itemRow } = await user
        .from("items")
        .select("subtype_id")
        .eq("title", "Dedup Test Item")
        .single();
      expect(itemRow?.subtype_id).toBe(predefinedRpgId);

      // Still exactly one "RPG" predefined row in Games -- no duplicate.
      const { data: gamesRpgRows } = await user
        .from("subtypes")
        .select("id")
        .eq("category_id", gamesCategory.id)
        .ilike("name", "rpg");
      expect(gamesRpgRows).toHaveLength(1);

      // A same-named "RPG" subtype created in a *different* category (Books)
      // must not be treated as a duplicate of the Games one -- category
      // scoping, per subtypes_category_lower_name_user_key.
      const { data: booksCategory } = await user
        .from("categories")
        .select("id")
        .eq("slug", "books")
        .single();
      if (!booksCategory) throw new Error("books category not found");

      await page.goto("/add");
      await page.getByLabel("Title").fill("Cross Category Test Item");
      await page.getByLabel("Category").selectOption({ label: "Books" });
      await page.getByLabel("Subtype", { exact: true }).selectOption({ label: "+ Create new subtype…" });
      await page.getByLabel("New subtype name").fill("RPG");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByLabel("New subtype name")).toHaveCount(0, { timeout: 15_000 });

      await page.getByRole("button", { name: /^add item$/i }).click();
      await page.waitForURL(/\/books\/[0-9a-f-]+$/);

      const { data: booksRpgRows } = await user
        .from("subtypes")
        .select("id, user_id")
        .eq("category_id", booksCategory.id)
        .ilike("name", "rpg");
      expect(booksRpgRows).toHaveLength(1);
      expect(booksRpgRows![0].id).not.toBe(predefinedRpgId);
      expect(booksRpgRows![0].user_id).toBe(userId);

      // The original Games "RPG" row is still exactly one row -- creating
      // the Books one didn't collide with or duplicate it.
      const { data: gamesRpgRowsAfter } = await user
        .from("subtypes")
        .select("id")
        .eq("category_id", gamesCategory.id)
        .ilike("name", "rpg");
      expect(gamesRpgRowsAfter).toHaveLength(1);
      expect(gamesRpgRowsAfter![0].id).toBe(predefinedRpgId);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("empty/whitespace-only submission is rejected client-side -- no subtypes row is created", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("subtype-empty");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      await page.goto("/add");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype", { exact: true }).selectOption({ label: "+ Create new subtype…" });
      // The Create button itself is disabled for a trim-empty value (same
      // guard as ItemTagsEditor's Add button), so this exercises the other
      // submit path -- Enter inside the input -- which still runs
      // handleCreate()'s subtypeNameSchema re-check regardless of the
      // button's disabled state. Same pattern as item-tags.spec.ts's own
      // empty-submission test.
      await page.getByLabel("New subtype name").fill("   ");
      await page.getByLabel("New subtype name").press("Enter");

      await expect(page.getByText("Enter a subtype name")).toBeVisible();

      const { data: subtypes } = await user
        .from("subtypes")
        .select("id")
        .eq("user_id", userId);
      expect(subtypes).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("RLS: a user's custom subtype is invisible to another user, can't be created for another user's id, and the ownership check blocks attaching another user's private subtype to an item via a crafted direct insert", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ownerEmail = randomTestEmail("subtype-rls-owner");
    const attackerEmail = randomTestEmail("subtype-rls-attacker");
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;

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
      if (!gamesCategory) throw new Error("games category not found");

      const { data: ownerSubtype, error: ownerSubtypeError } = await owner
        .from("subtypes")
        .insert({
          name: "OwnerPrivateSubtype",
          user_id: ownerId,
          category_id: gamesCategory.id,
        })
        .select("id")
        .single();
      expect(ownerSubtypeError).toBeNull();
      const ownerSubtypeId = ownerSubtype!.id as string;

      await page.context().clearCookies();
      await registerViaUI(page, attackerEmail);
      attackerId = await getUserIdByEmail(admin, attackerEmail);
      if (!attackerId) throw new Error("attacker id not found after registration");
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      // 1. subtypes_insert_own: attacker can't create a subtype owned by
      // the owner.
      const { data: spoofed, error: spoofError } = await attacker
        .from("subtypes")
        .insert({ name: "Spoofed", user_id: ownerId, category_id: gamesCategory.id })
        .select("id");
      expect(spoofError).not.toBeNull();
      expect(spoofed).toBeNull();

      // 2. subtypes_select_authenticated: the owner's private subtype is
      // invisible to the attacker -- RLS, not just app-level query
      // filtering.
      const { data: invisible } = await attacker
        .from("subtypes")
        .select("id")
        .eq("id", ownerSubtypeId);
      expect(invisible).toEqual([]);

      // 3. items_check_subtype_category's extended ownership check: the
      // attacker can't create their own item directly naming the owner's
      // private subtype id, even though category_id matches -- a crafted
      // insert bypassing the UI/SubtypePicker entirely.
      const { data: stolenItem, error: stolenItemError } = await attacker
        .from("items")
        .insert({
          user_id: attackerId,
          category_id: gamesCategory.id,
          subtype_id: ownerSubtypeId,
          title: "Stolen Subtype Attempt",
          status: "planned",
        })
        .select("id");
      expect(stolenItemError).not.toBeNull();
      expect(stolenItem).toBeNull();

      const { data: attackerItems } = await attacker
        .from("items")
        .select("id")
        .eq("title", "Stolen Subtype Attempt");
      expect(attackerItems).toEqual([]);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
