import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #17 (Tag management on an item): the real
// always-interactive Tags section + attach/detach/create Server Actions
// against the live project, including the two things unit coverage
// (lib/actions/tags.test.ts) can mock around but can't actually prove live:
// (1) the case-insensitive dedup, both at the app level and at the new
// tags_lower_name_user_key unique index itself, and (2) the new tags RLS
// policies (INSERT scoped to auth.uid(), SELECT scoped to predefined-or-own,
// and item_tags_insert_own's tag-visibility check). Each test registers its
// own disposable account(s) via the real UI and deletes them afterward, same
// convention as item-edit.spec.ts/item-detail.spec.ts.

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

// Attach/detach are fire-and-forget from the UI's perspective (optimistic
// local state update, with the real Server Action round trip continuing in
// the background) -- a DB assertion made the instant the UI reflects the
// optimistic change can race the real write. Polling here (rather than
// asserting once) waits out that race instead of asserting on it.
async function pollItemTagIds(
  user: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  itemId: string,
): Promise<string[]> {
  const { data } = await user.from("item_tags").select("tag_id").eq("item_id", itemId);
  return (data ?? []).map((row) => row.tag_id as string).sort();
}

test.describe("Tag management on an item (issue #17)", () => {
  test("attach (via autocomplete) and detach both work without ever clicking Edit, and leave status/rating untouched", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemtags-toggle");
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
        "No-Edit-Toggle Test",
      );

      await page.goto(`/${categorySlug}/${itemId}`);
      // Still in view mode -- no Status <select> present.
      await expect(page.getByLabel("Status")).toHaveCount(0);

      await page.getByLabel("Add a tag").fill("coz");
      await page.getByRole("button", { name: "cozy" }).click();
      // Longer-than-default timeout -- same live-round-trip latency
      // reasoning as the other timeout bumps in this file (attachTagAction's
      // own round trip against the live project, same pre-existing flake
      // class, not something isolated to the typed-submit path either).
      await expect(page.getByText("cozy")).toBeVisible({ timeout: 15_000 });

      // Never entered edit mode for the attach -- still no Status <select>.
      await expect(page.getByLabel("Status")).toHaveCount(0);

      await expect.poll(() => pollItemTagIds(user, itemId)).toHaveLength(1);

      await page.getByRole("button", { name: "Remove cozy" }).click();
      await expect(page.getByText("cozy")).toHaveCount(0);
      await expect(page.getByLabel("Status")).toHaveCount(0);

      await expect.poll(() => pollItemTagIds(user, itemId)).toHaveLength(0);

      // The item itself was never touched by any of this.
      const { data: row } = await user
        .from("items")
        .select("status, rating")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("planned");
      expect(row?.rating).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("typing a case-variant of a predefined tag attaches the existing row instead of creating a duplicate", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemtags-dedup-predefined");
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
        "Predefined Dedup Test",
      );

      const { data: predefinedBefore } = await user
        .from("tags")
        .select("id")
        .is("user_id", null)
        .ilike("name", "cozy");
      expect(predefinedBefore).toHaveLength(1);
      const predefinedTagId = predefinedBefore![0].id as string;

      await page.goto(`/${categorySlug}/${itemId}`);
      // Typed submit path (Enter), not the autocomplete-click path -- upper-
      // case + padding, trimmed/case-insensitive match required.
      await page.getByLabel("Add a tag").fill("  COZY  ");
      await page.getByLabel("Add a tag").press("Enter");
      // Longer-than-default timeout: the typed-submit path
      // (addTagToItemAction) does more sequential round trips against the
      // live project than the autocomplete-click path (attachTagAction)
      // above -- ownership check, a full visible-tags fetch for the dedup
      // lookup, then the insert -- which occasionally outran the default
      // 5s assertion timeout even with no code change here (pre-existing,
      // unrelated to issue #18; found while getting the full e2e suite
      // green for that issue's verification).
      await expect(page.getByText("cozy")).toBeVisible({ timeout: 15_000 });

      await expect.poll(() => pollItemTagIds(user, itemId)).toEqual([predefinedTagId]);

      const { data: predefinedAfter } = await user
        .from("tags")
        .select("id")
        .is("user_id", null)
        .ilike("name", "cozy");
      expect(predefinedAfter).toHaveLength(1);
      expect(predefinedAfter![0].id).toBe(predefinedTagId);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a new custom tag is created (trimmed, stored as typed) and re-typing a case-variant later attaches the same row, not a duplicate", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemtags-dedup-custom");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId: item1, categorySlug } = await insertGamesRpgItem(
        user,
        userId,
        "Custom Tag Create Test",
      );
      const { itemId: item2 } = await insertGamesRpgItem(user, userId, "Custom Tag Reuse Test");

      await page.goto(`/${categorySlug}/${item1}`);
      await page.getByLabel("Add a tag").fill("  MySpeedrunTag  ");
      await page.getByLabel("Add a tag").press("Enter");
      // See the timeout comment on the predefined-tag dedup test above --
      // same typed-submit round-trip latency, same pre-existing flake.
      await expect(page.getByText("MySpeedrunTag")).toBeVisible({ timeout: 15_000 });

      await expect
        .poll(async () => {
          const { data } = await user
            .from("tags")
            .select("id, name, user_id")
            .ilike("name", "myspeedruntag");
          return data?.length ?? 0;
        })
        .toBe(1);

      const { data: created } = await user
        .from("tags")
        .select("id, name, user_id")
        .ilike("name", "myspeedruntag");
      expect(created).toHaveLength(1);
      // Stored exactly as typed (trimmed) -- not lowercased.
      expect(created![0].name).toBe("MySpeedrunTag");
      expect(created![0].user_id).toBe(userId);
      const customTagId = created![0].id as string;

      // Different case, different item, same session -- must attach the
      // same row rather than create a second one.
      await page.goto(`/${categorySlug}/${item2}`);
      await page.getByLabel("Add a tag").fill("myspeedruntag");
      await page.getByLabel("Add a tag").press("Enter");
      // See the timeout comment above -- same typed-submit round trip.
      await expect(page.getByText("MySpeedrunTag")).toBeVisible({ timeout: 15_000 });

      await expect.poll(() => pollItemTagIds(user, item2)).toEqual([customTagId]);

      const { data: afterSecond } = await user
        .from("tags")
        .select("id")
        .ilike("name", "myspeedruntag");
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond![0].id).toBe(customTagId);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("empty/whitespace-only submission is rejected client-side -- no tags/item_tags row is created", async ({
    page,
  }) => {
    const email = randomTestEmail("itemtags-empty");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Empty Tag Test");

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByLabel("Add a tag").fill("   ");
      await page.getByLabel("Add a tag").press("Enter");

      // getByRole("alert") alone would also match Next.js's own
      // #__next-route-announcer__ live region -- scope to the specific
      // validation message.
      await expect(page.getByText("Enter a tag name")).toBeVisible();

      const { data: attached } = await user
        .from("item_tags")
        .select("tag_id")
        .eq("item_id", itemId);
      expect(attached).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("the tags_lower_name_user_key unique index rejects a raw duplicate insert directly at the database level", async ({
    page,
  }) => {
    const email = randomTestEmail("itemtags-uniqueindex");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: first, error: firstError } = await user
        .from("tags")
        .insert({ name: "UniqueIndexProbe", user_id: userId })
        .select("id")
        .single();
      expect(firstError).toBeNull();
      expect(first).not.toBeNull();

      // Same (lower(name), user_id) tuple, different case -- bypasses the
      // app-level lookup-before-create entirely (raw table insert), so only
      // the unique index itself can catch this.
      const { data: second, error: secondError } = await user
        .from("tags")
        .insert({ name: "uniqueindexprobe", user_id: userId })
        .select("id");

      expect(secondError).not.toBeNull();
      expect(secondError?.code).toBe("23505");
      expect(second).toBeNull();

      const { data: onlyRow } = await user
        .from("tags")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", "uniqueindexprobe");
      expect(onlyRow).toHaveLength(1);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("detaching a tag deletes only the item_tags row -- the tags row survives, whether predefined or still attached elsewhere", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemtags-detach-survives");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId: item1, categorySlug } = await insertGamesRpgItem(
        user,
        userId,
        "Detach Survives Item 1",
      );
      const { itemId: item2 } = await insertGamesRpgItem(
        user,
        userId,
        "Detach Survives Item 2",
      );

      const { data: predefined } = await user
        .from("tags")
        .select("id")
        .is("user_id", null)
        .ilike("name", "fantasy")
        .single();
      if (!predefined) throw new Error("predefined 'fantasy' tag not found");
      const fantasyId = predefined.id as string;

      // Attach the same predefined tag to both items directly (equivalent
      // to attaching via the UI on each), then detach it from only item1
      // through the real UI/Server Action flow.
      await user.from("item_tags").insert([
        { item_id: item1, tag_id: fantasyId },
        { item_id: item2, tag_id: fantasyId },
      ]);

      await page.goto(`/${categorySlug}/${item1}`);
      await expect(page.getByText("fantasy")).toBeVisible();
      await page.getByRole("button", { name: "Remove fantasy" }).click();
      await expect(page.getByText("fantasy")).toHaveCount(0);

      // Longer-than-default timeout -- same live-round-trip latency reasoning
      // as the typed-submit assertions above, this time on the detach path.
      await expect.poll(() => pollItemTagIds(user, item1), { timeout: 15_000 }).toHaveLength(0);

      // The tags row itself survives -- both because it's predefined, and
      // because item2 still references it.
      const { data: tagStillExists } = await user
        .from("tags")
        .select("id")
        .eq("id", fantasyId)
        .maybeSingle();
      expect(tagStillExists?.id).toBe(fantasyId);

      const { data: item2Tags } = await user
        .from("item_tags")
        .select("tag_id")
        .eq("item_id", item2);
      expect(item2Tags).toEqual([{ tag_id: fantasyId }]);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("RLS: a user's custom tag is invisible to another user, can't be created for another user's id, and can't be attached to another user's item by either owner", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ownerEmail = randomTestEmail("itemtags-rls-owner");
    const attackerEmail = randomTestEmail("itemtags-rls-attacker");
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;

    try {
      await registerViaUI(page, ownerEmail);
      ownerId = await getUserIdByEmail(admin, ownerEmail);
      if (!ownerId) throw new Error("owner id not found after registration");
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);

      const { itemId: ownerItemId } = await insertGamesRpgItem(
        owner,
        ownerId,
        "RLS Owner Item",
      );

      const { data: ownerTag, error: ownerTagError } = await owner
        .from("tags")
        .insert({ name: "OwnerPrivateTag", user_id: ownerId })
        .select("id")
        .single();
      expect(ownerTagError).toBeNull();
      const ownerTagId = ownerTag!.id as string;

      await page.context().clearCookies();
      await registerViaUI(page, attackerEmail);
      attackerId = await getUserIdByEmail(admin, attackerEmail);
      if (!attackerId) throw new Error("attacker id not found after registration");
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      const { itemId: attackerItemId } = await insertGamesRpgItem(
        attacker,
        attackerId,
        "RLS Attacker Item",
      );

      // 1. tags_insert_own: attacker can't create a tag owned by the owner.
      const { data: spoofed, error: spoofError } = await attacker
        .from("tags")
        .insert({ name: "Spoofed", user_id: ownerId })
        .select("id");
      expect(spoofError).not.toBeNull();
      expect(spoofed).toBeNull();

      // 2. tags_select_authenticated: the owner's private tag is invisible
      // to the attacker -- RLS, not just the app's own query filtering.
      const { data: invisible } = await attacker
        .from("tags")
        .select("id")
        .eq("id", ownerTagId);
      expect(invisible).toEqual([]);

      // 3. item_tags_insert_own's tag-visibility check: the attacker can't
      // attach the owner's private tag to their own item, even though they
      // own the item, by knowing the tag's id directly.
      const { data: stolenAttach, error: stolenAttachError } = await attacker
        .from("item_tags")
        .insert({ item_id: attackerItemId, tag_id: ownerTagId })
        .select();
      expect(stolenAttachError).not.toBeNull();
      expect(stolenAttach).toBeNull();

      const { data: attackerTags } = await attacker
        .from("item_tags")
        .select("tag_id")
        .eq("item_id", attackerItemId);
      expect(attackerTags).toEqual([]);

      // 4. items_update_own-style ownership: the attacker can't attach any
      // tag to the owner's item either.
      const { data: crossItemAttach, error: crossItemAttachError } = await attacker
        .from("item_tags")
        .insert({ item_id: ownerItemId, tag_id: ownerTagId })
        .select();
      expect(crossItemAttachError).not.toBeNull();
      expect(crossItemAttach).toBeNull();

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
