import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #34 (Manually set/edit completed_at): the
// real inline edit-mode form's new "Completed date" field + updateItemAction
// Server Action flow, against the live project. Complements
// lib/validation/items.test.ts (malformed-date rejection at the schema
// level) and lib/actions/items.test.ts (explicit-null-write/UTC-midnight
// conversion at the mocked-Supabase level) with what only a live browser +
// real project proves: the field round-trips through a real save + redirect
// + re-render, a cleared date actually reaches the row as NULL rather than
// silently no-oping, status changes alone never touch it, and -- the one
// thing #16's nudge tests couldn't previously prove either way, since the
// field didn't exist -- the "Mark Completed & Save" nudge really does leave
// a blank completed date blank rather than defaulting it to "today".

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
    review?: string | null;
    completedAt?: string | null;
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

  const { completedAt, ...restFields } = fields;
  const { data: item } = await user
    .from("items")
    .insert({
      user_id: userId,
      category_id: category.id,
      subtype_id: subtype.id,
      ...restFields,
      // Explicit snake_case mapping -- unlike title/status/rating/review,
      // which already match their DB column names 1:1, completed_at
      // doesn't match the camelCase `completedAt` param name (same
      // mismatch dashboard.spec.ts's own insertItem already handles the
      // same way).
      completed_at: completedAt ?? null,
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${fields.title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

test.describe("Manually set/edit completed_at (issue #34)", () => {
  test("setting a date in the Completed date field persists it as UTC midnight for that calendar day, and view mode shows it", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("completedat-set");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Set Completed Date Test",
        status: "ongoing",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();

      await page.getByLabel("Completed date").fill("2022-07-04");
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      // View mode's existing read-only "Completed: <date>" row, unchanged.
      await expect(page.getByText("Jul 4, 2022")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("completed_at")
        .eq("id", itemId)
        .single();
      // Compared via Date parsing rather than an exact string match --
      // robust to whichever ISO-8601 offset shape postgREST happens to
      // serialize a timestamptz as; what matters is the represented instant.
      expect(new Date(row!.completed_at as string).toISOString()).toBe(
        "2022-07-04T00:00:00.000Z",
      );

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("clearing a previously-set Completed date writes NULL to the row, not a silent no-op", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("completedat-clear");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Clear Completed Date Test",
        status: "completed",
        completedAt: "2021-05-01T00:00:00.000Z",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await expect(page.getByText("May 1, 2021")).toBeVisible();

      await page.getByRole("button", { name: /^edit$/i }).click();
      await expect(page.getByLabel("Completed date")).toHaveValue("2021-05-01");
      await page.getByLabel("Completed date").fill("");

      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("May 1, 2021")).toHaveCount(0);
      await expect(page.getByText(/^Completed:/)).toHaveCount(0);

      const { data: row } = await user
        .from("items")
        .select("completed_at")
        .eq("id", itemId)
        .single();
      expect(row?.completed_at).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("changing Status alone, in either direction, never changes an untouched Completed date", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("completedat-statusonly");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Status Only Test",
        status: "completed",
        completedAt: "2020-03-10T00:00:00.000Z",
      });

      // completed -> ongoing (away from Completed), field left alone.
      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();
      await page.getByLabel("Status").selectOption({ label: "Ongoing" });
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      let row = (
        await user.from("items").select("status, completed_at").eq("id", itemId).single()
      ).data;
      expect(row?.status).toBe("ongoing");
      expect(new Date(row!.completed_at as string).toISOString()).toBe(
        "2020-03-10T00:00:00.000Z",
      );

      // ongoing -> completed (into Completed), field still left alone.
      await page.getByRole("button", { name: /^edit$/i }).click();
      await page.getByLabel("Status").selectOption({ label: "Completed" });
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      row = (
        await user.from("items").select("status, completed_at").eq("id", itemId).single()
      ).data;
      expect(row?.status).toBe("completed");
      expect(new Date(row!.completed_at as string).toISOString()).toBe(
        "2020-03-10T00:00:00.000Z",
      );

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("the 'Mark Completed & Save' nudge only forces Status -- it never reads, defaults, or populates the Completed date field", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("completedat-nudge");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Nudge Never Touches Completed Date Test",
        status: "ongoing",
        rating: null,
        review: null,
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();

      // Rating newly filled, status not already Completed -- triggers the
      // nudge. The Completed date field is deliberately left blank.
      await page.getByLabel(/rating/i).fill("9");
      await expect(page.getByLabel("Completed date")).toHaveValue("");

      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(
        page.getByText(/sounds like you.?re done with this one/i),
      ).toBeVisible();

      await page.getByRole("button", { name: /mark completed & save/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("Completed", { exact: true })).toBeVisible();
      // No "Completed: <date>" row rendered -- the nudge set status only,
      // never defaulted completed_at to today or anything else.
      await expect(page.getByText(/^Completed:/)).toHaveCount(0);

      const { data: row } = await user
        .from("items")
        .select("status, rating, completed_at")
        .eq("id", itemId)
        .single();
      expect(row?.status).toBe("completed");
      expect(row?.rating).toBe(9);
      expect(row?.completed_at).toBeNull();

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a completed date earlier than the item's created_at is accepted -- backfilling a real-world completion date is not an error", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("completedat-backfill");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      // created_at defaults to "now" (item just inserted) -- 1999 is far
      // earlier than that, on purpose.
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Backfill Test",
        status: "completed",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();
      await page.getByLabel("Completed date").fill("1999-01-01");
      await page.getByRole("button", { name: /^save$/i }).click();

      // No validation error blocking the save -- straight back to view mode.
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Jan 1, 1999")).toBeVisible();

      const { data: row } = await user
        .from("items")
        .select("completed_at")
        .eq("id", itemId)
        .single();
      expect(new Date(row!.completed_at as string).toISOString()).toBe(
        "1999-01-01T00:00:00.000Z",
      );

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("setting a Completed date through the real edit form makes it show up as real data in the Dashboard's Completion trends chart", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = randomTestEmail("completedat-dashboard");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
        title: "Dashboard Confirmation Test",
        status: "completed",
      });

      await page.goto(`/${categorySlug}/${itemId}`);
      await page.getByRole("button", { name: /^edit$/i }).click();
      await page.getByLabel("Completed date").fill("2022-07-04");
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });

      await page.goto("/dashboard");
      const gamesPanel = page.locator('[aria-label="Games completion trend"]');
      await expect(gamesPanel).toBeVisible();
      await expect(gamesPanel.getByText(/no completion dates recorded yet/i)).toHaveCount(0);
      await expect(gamesPanel.locator('[title="Jul 2022: 1"]')).toHaveCount(1);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});

// QA's repro for the FAIL on the first pass of #34: the read-only
// "Completed:" row used formatDate(), which renders via Intl.DateTimeFormat
// with no timeZone override -- i.e. in the *viewer's* local browser
// timezone, not UTC. Since completed_at is stored as UTC midnight, any
// viewer in a timezone behind UTC saw the date roll back a calendar day
// (plus a React hydration mismatch, server vs. client disagreeing on the
// rendered date). Fixed by src/lib/format.ts's new formatDateOnly(), which
// forces timeZone: "UTC", used at this one call site in ItemEditForm.tsx.
// These two tests reproduce QA's exact repro (America/Los_Angeles, behind
// UTC) and its mirror (Asia/Tokyo, ahead of UTC) to prove the fix doesn't
// just shift the bug the other direction.
for (const { zone, label } of [
  { zone: "America/Los_Angeles", label: "behind UTC" },
  { zone: "Asia/Tokyo", label: "ahead of UTC" },
]) {
  test.describe(`Completed date display is timezone-independent -- ${zone} (${label})`, () => {
    test.use({ timezoneId: zone });

    test(`viewer in ${zone} sees the correct stored calendar date, no off-by-one, no hydration mismatch`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const email = randomTestEmail(`completedat-tz-${zone.split("/")[1].toLowerCase()}`);
      const admin = createSupabaseAdminClient();
      let userId: string | null = null;

      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      try {
        await registerViaUI(page, email);
        userId = await getUserIdByEmail(admin, email);
        if (!userId) throw new Error("test user id not found after registration");
        const user = await createSupabaseUserClient(email, TEST_PASSWORD);

        // Same value QA reproduced with: picking "2022-07-04" in the field
        // stores this exact UTC-midnight instant.
        const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
          title: `TZ Display Test (${zone})`,
          status: "completed",
          completedAt: "2022-07-04T00:00:00.000Z",
        });

        consoleErrors.length = 0;
        pageErrors.length = 0;
        await page.goto(`/${categorySlug}/${itemId}`);

        // Correct calendar date shown regardless of viewer timezone -- not
        // shifted a day earlier (behind UTC) or later (ahead of UTC).
        await expect(page.getByText("Jul 4, 2022")).toBeVisible();
        await expect(page.getByText("Jul 3, 2022")).toHaveCount(0);
        await expect(page.getByText("Jul 5, 2022")).toHaveCount(0);

        // No React hydration mismatch: server and client now agree, since
        // formatDateOnly's UTC override is independent of either side's
        // local timezone.
        const hydrationIssues = [...consoleErrors, ...pageErrors].filter((text) =>
          /hydrat/i.test(text),
        );
        expect(hydrationIssues).toEqual([]);

        await user.auth.signOut();
      } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
      }
    });
  });
}
