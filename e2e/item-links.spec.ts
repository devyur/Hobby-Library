import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #20 (Source links on an item): the real
// always-interactive Links section + addLinkAction/removeLinkAction Server
// Actions against the live project. Server-side URL-validation rejection and
// the ownership/"not found" check are already covered directly (unmocked
// Zod schema, mocked Supabase client) by lib/validation/links.test.ts and
// lib/actions/links.test.ts -- what only a live browser can prove is covered
// here instead: the section works without ever clicking "Edit", newly-added
// links appear without a refresh, insertion order survives a full page
// reload, and RLS truly blocks a cross-user item_links write independent of
// the app's own ownership check.
//
// Test accounts are created directly via the Supabase Admin API
// (auth.admin.createUser, email pre-confirmed) rather than through the
// public /register flow, to avoid adding to that endpoint's signup rate
// limit -- registerViaUI is what every other spec file in this repo uses,
// but the orchestrator flagged that limit as exhausted by heavy e2e testing
// across recent issues. Login still goes through the real UI (loginViaUI),
// since that's what actually exercises the app's auth/session/cookie flow.

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

test.describe("Source links on an item (issue #20)", () => {
  test("add (with and without a label) and remove both work without entering edit mode; order survives a reload", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemlinks-flow");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      userId = await createTestUser(admin, email);
      await loginViaUI(page, email);
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Links Flow Test");

      await page.goto(`/${categorySlug}/${itemId}`);
      // Scoped to the Links section -- Tags (ItemTagsEditor) has its own
      // same-styled "Add" button just above it, which an unscoped
      // getByRole("button", { name: "Add" }) would also match.
      const linksSection = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Links" }) });

      // Still in view mode -- no Status <select> present.
      await expect(page.getByLabel("Status")).toHaveCount(0);
      await expect(page.getByText("No links yet")).toBeVisible();

      // First link: labeled.
      await linksSection.getByLabel("URL").fill("https://www.imdb.com/title/tt0111161/");
      await linksSection.getByLabel("Label (optional)").fill("IMDb");
      await linksSection.getByRole("button", { name: "Add" }).click();

      const imdbLink = page.getByRole("link", { name: "IMDb" });
      await expect(imdbLink).toBeVisible({ timeout: 15_000 });
      await expect(imdbLink).toHaveAttribute("href", "https://www.imdb.com/title/tt0111161/");
      await expect(imdbLink).toHaveAttribute("target", "_blank");
      await expect(imdbLink).toHaveAttribute("rel", "noopener noreferrer");
      await expect(page.getByText("No links yet")).toHaveCount(0);
      // Field cleared on success.
      await expect(linksSection.getByLabel("URL")).toHaveValue("");
      await expect(linksSection.getByLabel("Label (optional)")).toHaveValue("");

      // Second link: no label -- falls back to the raw URL as link text.
      await linksSection.getByLabel("URL").fill("https://store.example.com/product");
      await linksSection.getByRole("button", { name: "Add" }).click();
      await expect(
        page.getByRole("link", { name: "https://store.example.com/product" }),
      ).toBeVisible({ timeout: 15_000 });

      // Never entered edit mode for either add.
      await expect(page.getByLabel("Status")).toHaveCount(0);

      // Insertion order (oldest first) immediately after adding, in this
      // session.
      const linksBeforeReload = page.locator("a[target='_blank']");
      await expect(linksBeforeReload).toHaveCount(2);
      await expect(linksBeforeReload.nth(0)).toHaveText("IMDb");
      await expect(linksBeforeReload.nth(1)).toHaveText("https://store.example.com/product");

      // Order survives a full page reload too.
      await page.reload();
      const linksAfterReload = page.locator("a[target='_blank']");
      await expect(linksAfterReload).toHaveCount(2);
      await expect(linksAfterReload.nth(0)).toHaveText("IMDb");
      await expect(linksAfterReload.nth(1)).toHaveText("https://store.example.com/product");

      // Remove the first link -- updates immediately, no reload needed.
      await page.getByRole("button", { name: "Remove IMDb" }).click();
      await expect(page.getByRole("link", { name: "IMDb" })).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "https://store.example.com/product" }),
      ).toBeVisible();
      await expect(page.getByLabel("Status")).toHaveCount(0);

      // Longer-than-default timeout -- same live-round-trip latency
      // reasoning as item-tags.spec.ts's polls: the optimistic UI update
      // and the real removeLinkAction round trip aren't the same moment.
      await expect
        .poll(
          async () => {
            const { data } = await user.from("item_links").select("id").eq("item_id", itemId);
            return data?.length ?? 0;
          },
          { timeout: 15_000 },
        )
        .toBe(1);

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

  test("RLS: another user can neither insert nor delete a link on someone else's item directly", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ownerEmail = randomTestEmail("itemlinks-rls-owner");
    const attackerEmail = randomTestEmail("itemlinks-rls-attacker");
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;

    try {
      ownerId = await createTestUser(admin, ownerEmail);
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);
      const { itemId: ownerItemId } = await insertGamesRpgItem(
        owner,
        ownerId,
        "RLS Owner Item",
      );

      const { data: ownerLink, error: ownerLinkError } = await owner
        .from("item_links")
        .insert({ item_id: ownerItemId, url: "https://owner.example.com" })
        .select("id")
        .single();
      expect(ownerLinkError).toBeNull();
      const ownerLinkId = ownerLink!.id as string;

      attackerId = await createTestUser(admin, attackerEmail);
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      // item_links_insert_own: attacker can't insert a link scoped to the
      // owner's item, even knowing its id.
      const { data: spoofed, error: spoofError } = await attacker
        .from("item_links")
        .insert({ item_id: ownerItemId, url: "https://attacker.example.com" })
        .select();
      expect(spoofError).not.toBeNull();
      expect(spoofed).toBeNull();

      // item_links_delete_own: attacker can't delete the owner's link.
      const { data: deleted, error: deleteError } = await attacker
        .from("item_links")
        .delete()
        .eq("id", ownerLinkId)
        .select();
      expect(deleteError).toBeNull();
      // RLS silently filters the row out of the delete rather than erroring
      // -- assert nothing was actually removed instead.
      expect(deleted).toEqual([]);

      const { data: stillThere } = await owner
        .from("item_links")
        .select("id")
        .eq("id", ownerLinkId)
        .maybeSingle();
      expect(stillThere?.id).toBe(ownerLinkId);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
