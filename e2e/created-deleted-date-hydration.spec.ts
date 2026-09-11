import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end repro for issue #46: ItemEditForm.tsx's "Added:" row
// (formatDate(createdAt)) and TrashList.tsx's "Deleted ..." row
// (formatDate(item.deletedAt)) both render a genuine local-time timestamp
// from a client component that also server-renders -- so, before this fix,
// the server's own local timezone and the viewer's forced browser timezone
// could disagree on the rendered calendar date, producing a real React
// hydration mismatch. Same forced-timezone repro shape as
// completed-date.spec.ts's TZ tests for #34 (behind UTC / ahead of UTC),
// applied here to created_at/deleted_at instead of completed_at. Unlike
// #34's fix (forcing UTC display, since completed_at is a date-only value),
// created_at/deleted_at must keep displaying the viewer's real local time --
// so this only asserts the absence of a hydration-mismatch error, not a
// changed displayed value; LocalDate.test.tsx (Vitest) already covers the
// placeholder/swap mechanics directly.

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
  fields: { title: string; deletedAt?: string | null },
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
      title: fields.title,
      status: "planned",
      deleted_at: fields.deletedAt ?? null,
    })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${fields.title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

function collectHydrationErrors(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return () => [...consoleErrors, ...pageErrors].filter((text) => /hydrat/i.test(text));
}

for (const { zone, label } of [
  { zone: "America/Los_Angeles", label: "behind UTC" },
  { zone: "Asia/Tokyo", label: "ahead of UTC" },
]) {
  test.describe(`created_at / deleted_at display -- ${zone} (${label})`, () => {
    test.use({ timezoneId: zone });

    test(`item detail page's "Added:" row renders with no hydration mismatch in ${zone}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const email = randomTestEmail(`createdat-tz-${zone.split("/")[1].toLowerCase()}`);
      const admin = createSupabaseAdminClient();
      let userId: string | null = null;

      try {
        await registerViaUI(page, email);
        userId = await getUserIdByEmail(admin, email);
        if (!userId) throw new Error("test user id not found after registration");
        const user = await createSupabaseUserClient(email, TEST_PASSWORD);

        const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, {
          title: `Created-At TZ Test (${zone})`,
        });

        const getHydrationErrors = collectHydrationErrors(page);
        await page.goto(`/${categorySlug}/${itemId}`);

        await expect(page.getByText("Added:")).toBeVisible();
        expect(getHydrationErrors()).toEqual([]);

        await user.auth.signOut();
      } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
      }
    });

    test(`Trash's "Deleted ..." row renders with no hydration mismatch in ${zone}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const email = randomTestEmail(`deletedat-tz-${zone.split("/")[1].toLowerCase()}`);
      const admin = createSupabaseAdminClient();
      let userId: string | null = null;

      try {
        await registerViaUI(page, email);
        userId = await getUserIdByEmail(admin, email);
        if (!userId) throw new Error("test user id not found after registration");
        const user = await createSupabaseUserClient(email, TEST_PASSWORD);

        await insertGamesRpgItem(user, userId, {
          title: `Deleted-At TZ Test (${zone})`,
          deletedAt: new Date().toISOString(),
        });

        const getHydrationErrors = collectHydrationErrors(page);
        await page.goto("/trash");

        // Scoped like trash.spec.ts's own assertion -- a bare /Deleted/
        // also matches this test's own item title text.
        await expect(page.getByText(/Games.*RPG.*Deleted/)).toBeVisible();
        expect(getHydrationErrors()).toEqual([]);

        await user.auth.signOut();
      } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
      }
    });
  });
}
