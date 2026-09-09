import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #14 (Full Add form): the real form + Server
// Action flow, category->subtype reactive filtering, minimum-valid-item
// enforcement client- and server-side, and the server-side rejection of a
// tampered category/subtype mismatch that the UI itself can't produce.
// Each test registers its own disposable account via the real UI and
// deletes it (via the Supabase admin API) afterward, same convention as the
// rest of this suite.

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Full Add form (issue #14)", () => {
  test("minimum valid item (title + category + subtype + status) creates the item and redirects to its detail page", async ({
    page,
  }) => {
    // Registration + a real Server Action POST + a redirect + detail-page
    // render, run under fullyParallel worker contention against the one
    // shared dev server -- the same class of slowdown item-detail.spec.ts's
    // heaviest test already documents; double the default budget rather
    // than lower everyone else's.
    test.setTimeout(60_000);
    const email = randomTestEmail("additem-min");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      await page.goto("/add");

      await page.getByLabel("Title").fill("Minimum Item");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype").selectOption({ label: "RPG" });
      // Status is pre-selected to "Planned" (the DB default) -- left alone.
      await expect(page.getByLabel("Status")).toHaveValue("planned");

      await page.getByRole("button", { name: /^add item$/i }).click();

      await page.waitForURL(/\/games\/[0-9a-f-]+$/);
      await expect(
        page.getByRole("heading", { name: "Minimum Item", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText("Games · RPG")).toBeVisible();
      await expect(page.getByText("Planned")).toBeVisible();

      // Nothing else was set -- no rating/priority badge, no Notes/Review
      // section. The Tags heading itself is always present (issue #17 made
      // it an always-interactive add-tag section, not conditional on
      // already having tags) -- but with no tag chips attached.
      await expect(page.getByText(/\/10/)).toHaveCount(0);
      await expect(page.getByText(/^(Low|Medium|High)$/)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Tags" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Remove /i })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Notes" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Review" })).toHaveCount(0);

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { data: items } = await user
        .from("items")
        .select("id, rating, priority, notes, review")
        .eq("title", "Minimum Item");
      expect(items).toHaveLength(1);
      expect(items?.[0]?.rating).toBeNull();
      expect(items?.[0]?.priority).toBeNull();
      expect(items?.[0]?.notes).toBeNull();
      expect(items?.[0]?.review).toBeNull();
      const { data: itemTags } = await user
        .from("item_tags")
        .select("tag_id")
        .eq("item_id", items![0].id);
      expect(itemTags).toHaveLength(0);
      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("category -> subtype reactive filtering: Subtype is disabled until a category is chosen, offers only that category's subtypes, and a category change clears the stale subtype", async ({
    page,
  }) => {
    const email = randomTestEmail("additem-filter");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);
      await page.goto("/add");

      const subtypeSelect = page.getByLabel("Subtype");
      await expect(subtypeSelect).toBeDisabled();

      await page.getByLabel("Category").selectOption({ label: "Games" });
      await expect(subtypeSelect).toBeEnabled();

      const gamesOptionLabels = await subtypeSelect
        .locator("option")
        .allTextContents();
      expect(gamesOptionLabels).toEqual(
        expect.arrayContaining(["RPG", "Action", "Other"]),
      );
      expect(gamesOptionLabels).not.toEqual(
        expect.arrayContaining(["Fiction"]),
      );

      await subtypeSelect.selectOption({ label: "RPG" });
      await expect(subtypeSelect).toHaveValue(/.+/);

      // Changing Category clears the now-invalid Subtype selection rather
      // than leaving "RPG" (a Games subtype) selected under Books.
      await page.getByLabel("Category").selectOption({ label: "Books" });
      await expect(subtypeSelect).toHaveValue("");

      const booksOptionLabels = await subtypeSelect
        .locator("option")
        .allTextContents();
      expect(booksOptionLabels).toEqual(
        expect.arrayContaining(["Fiction", "Non-Fiction"]),
      );
      expect(booksOptionLabels).not.toEqual(expect.arrayContaining(["RPG"]));
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("full field set: rating, priority, tags, notes, and review are all saved and rendered on the detail page", async ({
    page,
  }) => {
    test.setTimeout(60_000); // see the comment on the "minimum valid item" test above
    const email = randomTestEmail("additem-full");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      await page.goto("/add");

      await page.getByLabel("Title").fill("Fully Specified Item");
      await page.getByLabel("Category").selectOption({ label: "Books" });
      await page.getByLabel("Subtype").selectOption({ label: "Fiction" });
      // Status left at its "Planned" default -- PriorityBadge (issue #12)
      // only renders for status === "planned", so this also exercises that
      // the priority just entered actually shows up on the detail page.
      await page.getByLabel(/rating/i).fill("7");
      await page.getByLabel("Priority").selectOption({ label: "High" });
      await page.getByLabel("fantasy", { exact: true }).check();
      await page.getByLabel("classic", { exact: true }).check();
      await page.getByLabel("Notes").fill("Working notes here.");
      await page.getByLabel("Review").fill("A considered review here.");

      await page.getByRole("button", { name: /^add item$/i }).click();

      await page.waitForURL(/\/books\/[0-9a-f-]+$/);
      await expect(
        page.getByRole("heading", { name: "Fully Specified Item", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText("Books · Fiction")).toBeVisible();
      await expect(page.getByText("Planned")).toBeVisible();
      await expect(page.getByText("7/10")).toBeVisible();
      await expect(page.getByText("High")).toBeVisible();
      await expect(page.getByText("fantasy")).toBeVisible();
      await expect(page.getByText("classic")).toBeVisible();
      await expect(page.getByText("Working notes here.")).toBeVisible();
      await expect(page.getByText("A considered review here.")).toBeVisible();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("client-side validation blocks an empty title, a missing category/subtype, and an out-of-range rating -- no navigation, no database write in any case", async ({
    page,
  }) => {
    const email = randomTestEmail("additem-clientvalid");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      // --- Empty title ---
      await page.goto("/add");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype").selectOption({ label: "RPG" });
      await page.getByRole("button", { name: /^add item$/i }).click();
      await expect(page.getByText("Title is required")).toBeVisible();
      expect(page.url()).toContain("/add");

      // --- No category (and thus no subtype) ---
      await page.goto("/add");
      await page.getByLabel("Title").fill("Some Title");
      await page.getByRole("button", { name: /^add item$/i }).click();
      await expect(page.getByText("Category is required")).toBeVisible();
      await expect(page.getByText("Subtype is required")).toBeVisible();
      expect(page.url()).toContain("/add");

      // --- Rating outside 1-10 ---
      await page.goto("/add");
      await page.getByLabel("Title").fill("Some Title");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype").selectOption({ label: "RPG" });
      await page.getByLabel(/rating/i).fill("11");
      await page.getByRole("button", { name: /^add item$/i }).click();
      await expect(page.getByText("Rating must be between 1 and 10")).toBeVisible();
      expect(page.url()).toContain("/add");

      // None of the three attempts above reached the Server Action.
      const { data: items } = await user.from("items").select("id");
      expect(items).toHaveLength(0);
      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("server-side validation rejects a tampered category/subtype mismatch that bypasses the dropdown's own filtering, with no item created", async ({
    page,
  }) => {
    const email = randomTestEmail("additem-tamper");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: booksCategory } = await user
        .from("categories")
        .select("id")
        .eq("slug", "books")
        .single();
      if (!booksCategory) throw new Error("books category not found");
      const { data: fictionSubtype } = await user
        .from("subtypes")
        .select("id, name")
        .eq("category_id", booksCategory.id)
        .eq("name", "Fiction")
        .single();
      if (!fictionSubtype) throw new Error("Fiction subtype not found");

      await page.goto("/add");
      await page.getByLabel("Title").fill("Tampered Submission");
      await page.getByLabel("Category").selectOption({ label: "Games" });
      await page.getByLabel("Subtype").selectOption({ label: "RPG" });

      // Bypass the UI's own category->subtype filtering entirely: inject a
      // Books subtype option into the (still Games-scoped) Subtype select
      // and select it directly at the DOM level -- what the cascading
      // dropdown itself makes unreachable through normal interaction, but
      // a hand-crafted/devtools-edited submission could still send.
      await page.evaluate((fictionSubtypeId) => {
        const select = document.getElementById("subtypeId") as HTMLSelectElement;
        const option = document.createElement("option");
        option.value = fictionSubtypeId;
        option.textContent = "Fiction (tampered)";
        select.appendChild(option);
        select.value = fictionSubtypeId;
      }, fictionSubtype.id);

      await page.getByRole("button", { name: /^add item$/i }).click();

      // Rejected server-side: stays on /add with a friendly field error,
      // not an unhandled 500 or a silently-created row. Longer-than-default
      // timeout: this waits on a real Server Action round trip (category +
      // subtype lookups, then the rejection) against the live project under
      // parallel-worker contention -- same pre-existing live-latency flake
      // class as the timeout bumps in item-tags.spec.ts, unrelated to any
      // code this issue (#18) touches (createItemAction's own subtype check
      // is unchanged here).
      await expect(
        page.getByText(/subtype does not belong to the selected category/i),
      ).toBeVisible({ timeout: 15_000 });
      expect(page.url()).toContain("/add");

      const { data: items } = await user
        .from("items")
        .select("id")
        .eq("title", "Tampered Submission");
      expect(items).toHaveLength(0);
      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
