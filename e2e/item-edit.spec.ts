import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #16 (Edit item -- core fields): the real
// inline edit-mode toggle + updateItemAction Server Action flow on the item
// detail page (no /edit route, no modal), including the two behaviors QA
// most needs live-checked: (1) clearing a previously-set field actually
// writes NULL to the row rather than silently no-oping (Supabase's
// .update() drops undefined-valued keys), and (2) the "mark Completed?"
// nudge fires exactly on its documented condition -- rating/review
// transitioning empty -> filled on *this* save, target status not already
// Completed -- and never on an unrelated field change. Each test registers
// its own disposable account via the real UI and deletes it afterward, same
// convention as item-detail.spec.ts/add-item.spec.ts.

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
  fields: {
    title: string;
    status: "planned" | "ongoing" | "completed" | "dropped";
    rating?: number | null;
    priority?: "low" | "medium" | "high" | null;
    notes?: string | null;
    review?: string | null;
  },
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
      ...fields,
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${fields.title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

test.describe("Edit item -- core fields (issue #16)", () => {
  test("Edit toggles the form in place; Cancel discards changes without writing anything", async ({
    page,
  }) => {
    const email = randomTestEmail("itemedit-cancel");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Cancel Test",
        status: "planned",
        rating: 5,
        priority: "medium",
        notes: "Original notes",
        review: "Original review",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await expect(page.getByText("5/10")).toBeVisible();
      await expect(page.getByText("Medium")).toBeVisible();

      await page.getByRole("button", { name: /^edit$/i }).click();
      await expect(page.getByLabel("Status")).toBeVisible();

      await page.getByLabel(/rating/i).fill("9");
      await page.getByLabel("Priority").selectOption({ label: "High" });
      await page.getByLabel("Notes").fill("Changed notes");

      await page.getByRole("button", { name: /^cancel$/i }).click();

      // Back to view mode, showing the pre-edit values -- nothing written.
      await expect(page.getByLabel("Status")).toHaveCount(0);
      await expect(page.getByText("5/10")).toBeVisible();
      await expect(page.getByText("Medium")).toBeVisible();
      await expect(page.getByText("Original notes")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("rating, priority, notes, review")
        .eq("id", itemId)
        .single();
      expect(row?.rating).toBe(5);
      expect(row?.priority).toBe("medium");
      expect(row?.notes).toBe("Original notes");
      expect(row?.review).toBe("Original review");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("clearing a previously-set rating, priority, notes, and review writes NULL to each column, not a silent no-op", async ({
    page,
  }) => {
    // Registration + a real Server Action POST + a redirect-triggered
    // reload, run under fullyParallel worker contention -- same class of
    // slowdown item-detail.spec.ts's heaviest test already documents;
    // double the default budget rather than lower everyone else's.
    test.setTimeout(60_000);
    const email = randomTestEmail("itemedit-clear");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Clear Test",
        status: "planned",
        rating: 7,
        priority: "low",
        notes: "Notes to clear",
        review: "Review to clear",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();

      await page.getByLabel(/rating/i).fill("");
      await page.getByLabel("Priority").selectOption({ label: "None" });
      await page.getByLabel("Notes").fill("");
      await page.getByLabel("Review").fill("");

      // All four fields are going from filled -> empty, not empty -> filled
      // -- the nudge must not intercept this save.
      await page.getByRole("button", { name: /^save$/i }).click();
      // The edit-mode toggle happens in place at the same URL (no /edit
      // route), so waitForURL wouldn't observe the round trip -- wait for
      // the Edit control to reappear instead, which only view mode shows.
      // Longer-than-default timeout for the same worker-contention reason
      // as the test.setTimeout above -- this is the one assertion that
      // actually waits on the redirect + server re-render round trip.
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText(/\/10/)).toHaveCount(0);
      await expect(page.getByText(/^(Low|Medium|High)$/)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Notes" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Review" })).toHaveCount(0);

      // The critical live check: NULL actually reached the row, not just
      // "the UI stopped showing the old value" (which a silently-ignored
      // update would also produce, since view mode simply wouldn't have
      // been re-fetched with the stale value... except it is re-fetched,
      // via the redirect -- so this DB read is the real assertion).
      const { data: row } = await user
        .from("items")
        .select("rating, priority, notes, review")
        .eq("id", itemId)
        .single();
      expect(row?.rating).toBeNull();
      expect(row?.priority).toBeNull();
      expect(row?.notes).toBeNull();
      expect(row?.review).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("nudge fires when rating/review newly filled and status isn't Completed; 'Just save' saves everything without touching status", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemedit-justsave");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Just Save Test",
        status: "planned",
        rating: null,
        priority: null,
        notes: null,
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();

      await page.getByLabel(/rating/i).fill("8");
      await page.getByLabel("Priority").selectOption({ label: "High" });
      await page.getByLabel("Notes").fill("Some notes");
      await page.getByLabel("Review").fill("A great review");

      await page.getByRole("button", { name: /^save$/i }).click();

      // Rating went null -> 8 and status ("planned") isn't Completed --
      // the nudge must intercept instead of submitting immediately.
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toBeVisible();
      expect(page.url()).toContain(`/${categorySlug}/${itemId}`);

      await page.getByRole("button", { name: /^just save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      // Status left exactly as submitted (Planned, untouched by the nudge),
      // but every other changed field still saved.
      await expect(page.getByText("Planned")).toBeVisible();
      await expect(page.getByText("8/10")).toBeVisible();
      await expect(page.getByText("High")).toBeVisible();
      await expect(page.getByText("Some notes")).toBeVisible();
      await expect(page.getByText("A great review")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("status, rating, priority, notes, review, completed_at")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("planned");
      expect(row?.rating).toBe(8);
      expect(row?.priority).toBe("high");
      expect(row?.completed_at).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("'Mark Completed & Save' sets status to Completed without ever writing completed_at", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemedit-markcompleted");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        // Deliberately avoids the word "Completed" in the title -- the
        // StatusPill also renders that exact word once the nudge sets
        // status to Completed below, and a title containing it would make
        // getByText("Completed") ambiguous.
        title: "Nudge Sets Status Test",
        status: "ongoing",
        rating: null,
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();

      // Only the review is newly filled -- rating stays empty. Status left
      // at "Ongoing" in the select; the nudge itself must be what sets it
      // to Completed, never an automatic side effect of adding a review.
      await page.getByLabel("Review").fill("Loved it, finished last night");

      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toBeVisible();

      await page.getByRole("button", { name: /mark completed & save/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("Completed", { exact: true })).toBeVisible();
      await expect(page.getByText("Loved it, finished last night")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("status, review, completed_at")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("completed");
      expect(row?.review).toBe("Loved it, finished last night");
      // The nudge only forces status -- it never reads/defaults the
      // Completed date field (issue #34), so an untouched (blank) field
      // stays null even when status becomes Completed through the nudge.
      // e2e/completed-date.spec.ts covers the field itself in depth.
      expect(row?.completed_at).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("re-editing an item that already has a rating/review never triggers the nudge -- only changing priority, or an existing rating 6 -> 8, saves immediately", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("itemedit-nonudge");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "No Nudge Test",
        status: "planned",
        rating: 6,
        priority: "medium",
        review: "Already reviewed this one",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();

      await page.getByLabel(/rating/i).fill("8");
      await page.getByLabel("Priority").selectOption({ label: "High" });

      await page.getByRole("button", { name: /^save$/i }).click();

      // No nudge -- both rating and review were already filled before this
      // save, so the empty -> filled transition never happened.
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toHaveCount(0);
      // The edit-mode toggle happens in place at the same URL (no /edit
      // route) -- waitForURL would resolve immediately since the URL already
      // matches before the round trip even starts, without ever waiting for
      // it. Wait for the Edit control to reappear instead, same fix as the
      // "clearing a previously-set rating..." test above; #18's added
      // subtype cross-check query in updateItemAction made this round trip
      // slow enough that the stale waitForURL call started failing outright
      // rather than merely racing.
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("8/10")).toBeVisible();
      await expect(page.getByText("High")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("status, rating, priority")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("planned");
      expect(row?.rating).toBe(8);
      expect(row?.priority).toBe("high");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("RLS (items_update_own) still blocks a direct update to another user's item, independent of the app's own ownership check", async ({
    page,
  }) => {
    const ownerEmail = randomTestEmail("itemedit-rls-owner");
    const attackerEmail = randomTestEmail("itemedit-rls-attacker");
    const admin = createSupabaseAdminClient();
    let ownerId: string | null = null;
    let attackerId: string | null = null;

    try {
      await registerViaUI(page, ownerEmail);
      ownerId = await getUserIdByEmail(admin, ownerEmail);
      if (!ownerId) throw new Error("owner id not found after registration");
      const owner = await createSupabaseUserClient(ownerEmail, TEST_PASSWORD);

      const { itemId } = await insertGamesRpgItem(owner, ownerId, {
        title: "Owner-Only Item",
        status: "planned",
        rating: 4,
      });

      await page.context().clearCookies();
      await registerViaUI(page, attackerEmail);
      attackerId = await getUserIdByEmail(admin, attackerEmail);
      if (!attackerId) throw new Error("attacker id not found after registration");
      const attacker = await createSupabaseUserClient(attackerEmail, TEST_PASSWORD);

      // Direct table-level update attempt, bypassing the app's own
      // ownership check entirely -- proves the items_update_own RLS policy
      // itself (user_id = auth.uid()) is what actually stops this, not
      // just updateItemAction's defensive .eq("user_id", ...) check.
      const { data: updated, error } = await attacker
        .from("items")
        .update({ rating: 10 })
        .eq("id", itemId)
        .select("id");

      // RLS makes the row invisible to the update's own WHERE clause --
      // zero rows affected, no thrown error (PostgREST's normal RLS
      // behavior), not a value change.
      expect(error).toBeNull();
      expect(updated).toEqual([]);

      const { data: unchanged } = await owner
        .from("items")
        .select("rating")
        .eq("id", itemId)
        .single();
      expect(unchanged?.rating).toBe(4);

      await attacker.auth.signOut();
      await owner.auth.signOut();
    } finally {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (attackerId) await admin.auth.admin.deleteUser(attackerId);
    }
  });
});
