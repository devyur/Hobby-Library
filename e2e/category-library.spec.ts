import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #12 (Category library view -- list +
// card). There is no in-app way to create an item yet (#14/#15), so these
// specs insert test item rows directly against the live DB using the
// signed-in test user's own (anon-key, RLS-scoped) client -- the same
// approach createSupabaseUserClient already uses for user_preferences reads
// in nav.spec.ts/settings.spec.ts, extended here to items/item_tags/
// item_images and a real cover upload to the `covers` Storage bucket.
// Each test registers its own disposable account and deletes it (plus any
// uploaded storage object) afterward.

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

// A minimal valid 1x1 transparent PNG, used as real cover-image bytes for
// the storage upload test -- exercises the actual `covers` bucket path
// (signed URL resolution, private-bucket policy) rather than a stub.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Category library view (issue #12)", () => {
  test("empty state: shows the always-visible List/Card toggle and 'No items in {category} yet.', plus the Add item entry point from issue #14", async ({
    page,
  }) => {
    const email = randomTestEmail("catlib-empty");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      await expect(page.getByRole("group", { name: "View mode" })).toBeVisible();
      await expect(page.getByRole("button", { name: "List" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Card" })).toBeVisible();

      await expect(page.getByText("No items in Games yet.")).toBeVisible();
      // issue #14: the Full Add form's entry point lives in the library view.
      await expect(page.getByRole("link", { name: "Add item" })).toHaveAttribute(
        "href",
        "/add",
      );
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("seeded items: List/Card rendering (cover, no-cover placeholder, priority rule, rating/tag display), fixed created_at-desc order, and list_view_mode persistence", async ({
    page,
  }) => {
    const email = randomTestEmail("catlib-seeded");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let coverStoragePath: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: category } = await user
        .from("categories")
        .select("id")
        .eq("slug", "games")
        .single();
      if (!category) throw new Error("games category not found");

      const { data: subtypes } = await user
        .from("subtypes")
        .select("id, name")
        .eq("category_id", category.id)
        .in("name", ["RPG", "Action"]);
      const rpgSubtype = subtypes?.find((s) => s.name === "RPG");
      const actionSubtype = subtypes?.find((s) => s.name === "Action");
      if (!rpgSubtype || !actionSubtype) throw new Error("expected subtypes not found");

      const { data: tags } = await user
        .from("tags")
        .select("id, name")
        .in("name", ["fantasy", "dark", "indie", "classic", "long", "short"]);
      if (!tags || tags.length < 6) throw new Error("expected predefined tags not found");
      const tagId = (name: string) => tags.find((t) => t.name === name)!.id;

      // Insert in this order (oldest first); the page must render them
      // created_at desc, i.e. Hades, Hollow Knight, Elden Ring.
      const { data: eldenRing } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Elden Ring",
          category_id: category.id,
          subtype_id: rpgSubtype.id,
          status: "planned",
          priority: "high",
          rating: null,
        })
        .select("id")
        .single();
      if (!eldenRing) throw new Error("insert Elden Ring failed");

      const { data: hollowKnight } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Hollow Knight",
          category_id: category.id,
          subtype_id: actionSubtype.id,
          status: "completed",
          priority: null,
          rating: null,
        })
        .select("id")
        .single();
      if (!hollowKnight) throw new Error("insert Hollow Knight failed");

      // Dropped with a leftover priority value (schema keeps priority even
      // when status moves away from Planned, per database-schema.md §3) --
      // this must NOT render a priority badge, since the rule is
      // status === 'planned', not merely "priority is not null".
      const { data: hades } = await user
        .from("items")
        .insert({
          user_id: userId,
          title: "Hades",
          category_id: category.id,
          subtype_id: actionSubtype.id,
          status: "dropped",
          priority: "medium",
          rating: 8,
        })
        .select("id")
        .single();
      if (!hades) throw new Error("insert Hades failed");

      await user.from("item_tags").insert([
        { item_id: eldenRing.id, tag_id: tagId("fantasy") },
        { item_id: eldenRing.id, tag_id: tagId("dark") },
        { item_id: eldenRing.id, tag_id: tagId("indie") },
        { item_id: eldenRing.id, tag_id: tagId("classic") },
        { item_id: eldenRing.id, tag_id: tagId("long") },
        { item_id: hades.id, tag_id: tagId("short") },
      ]);

      // Real cover upload for Hades only -- Elden Ring/Hollow Knight stay
      // cover-less to exercise the placeholder.
      coverStoragePath = `${userId}/${hades.id}/cover.png`;
      const { error: uploadError } = await user.storage
        .from("covers")
        .upload(coverStoragePath, ONE_PIXEL_PNG, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { error: imageInsertError } = await user.from("item_images").insert({
        item_id: hades.id,
        storage_path: coverStoragePath,
        is_cover: true,
      });
      if (imageInsertError) throw imageInsertError;

      // --- List view (default: no preference set yet) ---
      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      await expect(
        page.getByRole("button", { name: "List" }),
      ).toHaveAttribute("aria-pressed", "true");

      const rowTitles = page.locator("a", { hasText: /Elden Ring|Hollow Knight|Hades/ });
      await expect(rowTitles).toHaveCount(3);
      // Fixed created_at-desc order: most recently added first.
      await expect(rowTitles.nth(0)).toContainText("Hades");
      await expect(rowTitles.nth(1)).toContainText("Hollow Knight");
      await expect(rowTitles.nth(2)).toContainText("Elden Ring");

      const eldenRow = page.getByRole("link", { name: /Elden Ring/ });
      const hollowRow = page.getByRole("link", { name: /Hollow Knight/ });
      const hadesRow = page.getByRole("link", { name: /Hades/ });

      await expect(eldenRow).toHaveAttribute("href", `/games/${eldenRing.id}`);

      // Rating badge: omitted (not "0/10") for null rating, shown for a
      // real rating.
      await expect(eldenRow.getByText(/\/10/)).toHaveCount(0);
      await expect(hollowRow.getByText(/\/10/)).toHaveCount(0);
      await expect(hadesRow.getByText("8/10")).toBeVisible();

      // Status pills.
      await expect(eldenRow.getByText("Planned")).toBeVisible();
      await expect(hollowRow.getByText("Completed")).toBeVisible();
      await expect(hadesRow.getByText("Dropped")).toBeVisible();

      // Subtype names.
      await expect(eldenRow.getByText("RPG")).toBeVisible();
      await expect(hadesRow.getByText("Action")).toBeVisible();

      // Priority badge: shown only for the planned item with a priority --
      // Hades (dropped, priority='medium') must NOT show one.
      await expect(eldenRow.getByText("High")).toBeVisible();
      await expect(hadesRow.getByText("Medium")).toHaveCount(0);
      await expect(hollowRow.getByText(/^(Low|Medium|High)$/)).toHaveCount(0);

      // Tag chips: 5 tags on Elden Ring truncate to 3 + "+2"; Hades' single
      // tag renders with no overflow indicator.
      await expect(eldenRow.getByText("fantasy")).toBeVisible();
      await expect(eldenRow.getByText("dark")).toBeVisible();
      await expect(eldenRow.getByText("indie")).toBeVisible();
      await expect(eldenRow.getByText("classic")).toHaveCount(0);
      await expect(eldenRow.getByText("long")).toHaveCount(0);
      await expect(eldenRow.getByText("+2")).toBeVisible();
      await expect(hadesRow.getByText("short")).toBeVisible();
      await expect(hadesRow.getByText(/^\+\d+$/)).toHaveCount(0);

      // --- Toggle to Card view ---
      await page.getByRole("button", { name: "Card" }).click();
      await expect(page.getByRole("button", { name: "Card" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      const hadesCard = page.getByRole("link", { name: /Hades/ });
      const eldenCard = page.getByRole("link", { name: /Elden Ring/ });

      // Real cover image renders for Hades; Elden Ring (no cover) gets the
      // defined placeholder, not a broken/empty image.
      await expect(hadesCard.getByRole("img", { name: "Cover for Hades" })).toBeVisible();
      const coverSrc = await hadesCard
        .getByRole("img", { name: "Cover for Hades" })
        .getAttribute("src");
      // Public URL (issue #38 -- the `covers` bucket is public, so this is
      // getPublicUrl(), not a signed URL) carrying a `?v=` cache-busting
      // param sourced from item_images.updated_at.
      expect(coverSrc).toContain("/storage/v1/object/public/covers/");
      expect(coverSrc).toContain(coverStoragePath!.split("/").pop());
      expect(coverSrc).toMatch(/\?v=\d+$/);

      await expect(
        eldenCard.getByRole("img", { name: /no cover image for elden ring/i }),
      ).toBeVisible();

      // Same conditional priority/rating/status rules apply in Card view.
      await expect(eldenCard.getByText("High")).toBeVisible();
      await expect(hadesCard.getByText("8/10")).toBeVisible();
      await expect(hadesCard.getByText("Dropped")).toBeVisible();

      // --- Persistence: reload and confirm Card mode survives ---
      // The toggle's persistence write is fire-and-forget (same convention
      // as updateThemePreference/updateLastScreen) -- poll the row directly
      // before reloading, same pattern as nav.spec.ts's last_screen test,
      // rather than racing the write with a reload.
      await expect
        .poll(async () => {
          const { data } = await user
            .from("user_preferences")
            .select("list_view_mode")
            .maybeSingle();
          return data?.list_view_mode ?? null;
        })
        .toBe("card");

      await page.reload();
      await expect(page.getByRole("button", { name: "Card" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(
        page.getByRole("link", { name: /Hades/ }).getByRole("img", { name: "Cover for Hades" }),
      ).toBeVisible();

      await user.auth.signOut();
    } finally {
      if (userId && coverStoragePath) {
        await admin.storage.from("covers").remove([coverStoragePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
