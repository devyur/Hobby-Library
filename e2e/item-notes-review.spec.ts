import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #48 (always-interactive Notes/Review, with
// empty-state CTAs): the real NotesReview.tsx editors + their own
// updateNotesAction/updateReviewAction/markItemCompletedAction Server
// Actions against the live project. Complements lib/actions/items.test.ts
// (mocked branches) and components/items/NotesReview.test.tsx (component
// interaction) with what only a real browser + live DB round trip can prove:
// (1) each field saves independently of the main Edit/Save form, whether
// that form is open or closed, (2) the empty-state "Add a note"/"Add a
// review" CTA really is a focusable button that expands a real textarea,
// (3) the Review-triggered nudge -- a live check-after-save read of the
// item's current review/status -- fires/doesn't fire on the documented
// condition and never blocks the save itself, and (4) "Mark Completed"
// updates the status badge in place (revalidatePath) without a full page
// navigation. Each test registers its own disposable account via the real
// UI and deletes it afterward, same convention as item-edit.spec.ts/
// item-tags.spec.ts.

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

test.describe("Always-interactive Notes/Review (issue #48)", () => {
  test("empty Notes/Review show real focusable 'Add a note'/'Add a review' buttons that expand a textarea, and each saves independently of the other and of the main form", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("notesreview-empty");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Empty Notes Review Test",
        status: "planned",
        notes: null,
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);

      // Real, focusable buttons -- not blank space, not a click-anywhere
      // affordance.
      const addNoteButton = page.getByRole("button", { name: "Add a note" });
      const addReviewButton = page.getByRole("button", { name: "Add a review" });
      await expect(addNoteButton).toBeVisible();
      await expect(addReviewButton).toBeVisible();
      await addNoteButton.focus();
      await expect(addNoteButton).toBeFocused();

      // Still in view mode -- neither CTA requires the main Edit/Save form.
      await expect(page.getByLabel("Status")).toHaveCount(0);

      await addNoteButton.click();
      await page.getByRole("textbox", { name: "Notes" }).fill("A quick working note");
      await page.getByRole("button", { name: /^save$/i }).click();

      // Wait for the field to actually settle (collapse back to its
      // populated display, "Edit note" reappearing) rather than for the
      // typed text alone to be visible -- a controlled <textarea>'s value is
      // mirrored into its own text content, so `getByText` on the typed
      // string would give a false-positive match against the still-pending,
      // not-yet-saved textarea itself, racing ahead of the real save.
      await expect(page.getByRole("button", { name: "Edit note" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("A quick working note")).toBeVisible();
      // Never entered the main form for this save.
      await expect(page.getByLabel("Status")).toHaveCount(0);

      await addReviewButton.click();
      await page
        .getByRole("textbox", { name: "Review" })
        .fill("A considered opinion, saved on its own");
      await page.getByRole("button", { name: /^save$/i }).click();

      await expect(page.getByRole("button", { name: "Edit review" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("A considered opinion, saved on its own"),
      ).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("notes, review")
        .eq("id", itemId)
        .single();
      expect(row?.notes).toBe("A quick working note");
      expect(row?.review).toBe("A considered opinion, saved on its own");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Notes/Review stay visible and editable while the main Edit/Save form is open, and saving one never appears inside that form's own submit", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("notesreview-mainformopen");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Main Form Open Test",
        status: "planned",
        notes: "Existing note",
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();
      await expect(page.getByLabel("Status")).toBeVisible();

      // Notes' own Edit control (not the main form's) is still present and
      // usable while the main form is open.
      await expect(page.getByText("Existing note")).toBeVisible();
      // Scoped to the Review section -- the main form also has its own
      // (currently unrelated) Save button visible at the same time, so an
      // unscoped getByRole("button", { name: "Save" }) would be ambiguous.
      const reviewSection = page.locator("section", {
        has: page.getByRole("heading", { name: "Review" }),
      });
      await reviewSection.getByRole("button", { name: "Add a review" }).click();
      await reviewSection
        .getByRole("textbox", { name: "Review" })
        .fill("Saved while the main form was still open");
      await reviewSection.getByRole("button", { name: "Save" }).click();

      // Wait for the real settled state (see the previous test's own
      // comment on why `getByText` on the typed draft alone would be a
      // false-positive race against the still-pending textarea).
      await expect(reviewSection.getByRole("button", { name: "Edit review" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("Saved while the main form was still open"),
      ).toBeVisible();
      // The main form is still open, untouched by that save.
      await expect(page.getByLabel("Status")).toBeVisible();

      // Scoped to the main <form> itself -- Review's own field also has a
      // Cancel button while expanded, so an unscoped lookup can be
      // ambiguous depending on exact timing.
      await page.locator("form").getByRole("button", { name: /^cancel$/i }).click();

      const { data: row } = await user
        .from("items")
        .select("review")
        .eq("id", itemId)
        .single();
      expect(row?.review).toBe("Saved while the main form was still open");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Review-triggered nudge: two buttons only, fires after the save on a fresh empty->filled/not-completed check, and 'Mark Completed' updates the status badge without a full navigation", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("notesreview-nudge");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        // Avoids the word "Completed" in the title -- StatusPill renders
        // that exact word once the nudge sets status, and a title
        // containing it would make getByText("Completed") ambiguous.
        title: "Review Nudge Status Test",
        status: "ongoing",
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: "Add a review" }).click();
      await page.getByRole("textbox", { name: "Review" }).fill("Loved it, finishing tonight");
      await page.getByRole("button", { name: /^save$/i }).click();

      // The save always goes through, whether or not the nudge appears --
      // wait for the field to actually settle (not just for the typed text
      // to be visible, which would false-positive match the still-pending
      // textarea itself -- see the first test's own comment) before
      // asserting the value landed and looking at the banner.
      await expect(page.getByRole("button", { name: "Edit review" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Loved it, finishing tonight")).toBeVisible();

      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toBeVisible();
      // Two buttons only -- Mark Completed / Dismiss, no "Just save"/
      // "Cancel" (unlike the rating-triggered nudge in item-edit.spec.ts):
      // there's no pending/unsaved state here, the review already saved.
      await expect(page.getByRole("button", { name: "Mark Completed" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
      await expect(page.getByRole("button", { name: /just save/i })).toHaveCount(0);

      await page.getByRole("button", { name: "Mark Completed" }).click();

      // Status badge updates in place -- revalidatePath, not a redirect/full
      // navigation -- so the URL never changes and the page never reloads.
      await expect(page.getByText("Completed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      expect(page.url()).toContain(`/${categorySlug}/${itemId}`);
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toHaveCount(0);

      const { data: row } = await user
        .from("items")
        .select("status, review")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("completed");
      expect(row?.review).toBe("Loved it, finishing tonight");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Dismiss hides the Review nudge without changing status; re-editing an already-filled review never re-triggers it", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("notesreview-dismiss");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Review Nudge Dismiss Test",
        status: "planned",
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: "Add a review" }).click();
      await page.getByRole("textbox", { name: "Review" }).fill("First pass thoughts");
      await page.getByRole("button", { name: /^save$/i }).click();

      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Dismiss" }).click();
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toHaveCount(0);

      const { data: afterDismiss } = await user
        .from("items")
        .select("status")
        .eq("id", itemId)
        .single();
      expect(afterDismiss?.status).toBe("planned");

      // Re-editing an already-filled review (not empty -> filled on *this*
      // save) must never re-trigger the nudge.
      await page.getByRole("button", { name: "Edit review" }).click();
      await page
        .getByRole("textbox", { name: "Review" })
        .fill("Revised thoughts after finishing");
      await page.getByRole("button", { name: /^save$/i }).click();

      // Settled state first (see the first test's own comment on the
      // getByText-vs-pending-textarea false-positive race), then the text.
      await expect(page.getByRole("button", { name: "Edit review" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Revised thoughts after finishing")).toBeVisible();
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toHaveCount(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("editing/saving Notes never triggers the nudge, in either direction", async ({ page }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("notesreview-notesnonudge");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Notes Never Nudges Test",
        status: "planned",
        notes: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: "Add a note" }).click();
      await page.getByRole("textbox", { name: "Notes" }).fill("Just a working note, not a review");
      await page.getByRole("button", { name: /^save$/i }).click();

      // Settled state first (see the first test's own comment on the
      // getByText-vs-pending-textarea false-positive race), then the text.
      await expect(page.getByRole("button", { name: "Edit note" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Just a working note, not a review")).toBeVisible();
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toHaveCount(0);

      const { data: row } = await user
        .from("items")
        .select("status")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("planned");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Cancel on an expanded field discards the draft without saving, reverting to the prior value", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("notesreview-cancel");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Notes Cancel Test",
        status: "planned",
        notes: "Keep this note",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: "Edit note" }).click();
      await page.getByRole("textbox", { name: "Notes" }).fill("This should be discarded");
      await page.getByRole("button", { name: /^cancel$/i }).click();

      await expect(page.getByText("Keep this note")).toBeVisible();
      await expect(page.getByText("This should be discarded")).toHaveCount(0);

      const { data: row } = await user
        .from("items")
        .select("notes")
        .eq("id", itemId)
        .single();
      expect(row?.notes).toBe("Keep this note");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
