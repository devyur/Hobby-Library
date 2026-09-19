import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #62 (Connections page: import owned games
// from Steam). Unlike most of this suite, the Steam-lookup flow genuinely
// calls the real, live Steam Web API/CDN (STEAM_API_KEY must be set in
// .env.local; lib/actions/steam.ts reads it server-side) -- there is no
// mocked fixture path for this feature, so this spec is the only place its
// happy-path/partial-failure behavior is verified against real data.
//
// Test profile: "garry" (SteamID64 76561197960279927) -- Garry Newman,
// creator of Garry's Mod/Facepunch Studios. Confirmed public during
// grooming/QA verification: GetPlayerSummaries reports
// communityvisibilitystate: 3 (public), and GetOwnedGames genuinely returns
// ~496 real games for this id, unlike several other well-known accounts
// tried (Gabe Newell, Robin Walker) whose "Game details" privacy setting is
// NOT public and return an empty {response:{}} -- exactly the private-
// profile case this feature's own error message describes.
//
// Two real, live-verified appids from that account are used deliberately:
//   - 20 (Team Fortress Classic): both library_600x900.jpg and header.jpg
//     resolve -- the full-success cover path.
//   - 943760 (SteamOS Devkit Client): both CDN URLs 404 for this appid
//     (confirmed live) -- a genuine, naturally-occurring "no cover
//     available" case, not an artificially injected failure.
//   - 10 (Counter-Strike): used only for the pre-seeded duplicate-marking
//     check below, never selected for import.

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

async function insertSeedItemWithLink(
  user: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  userId: string,
  title: string,
  linkUrl: string,
) {
  const { data: category } = await user.from("categories").select("id").eq("slug", "games").single();
  if (!category) throw new Error("games category not found");

  const { data: subtype } = await user
    .from("subtypes")
    .select("id")
    .eq("category_id", category.id)
    .eq("name", "Other")
    .single();
  if (!subtype) throw new Error("Other subtype not found");

  const { data: item } = await user
    .from("items")
    .insert({ user_id: userId, category_id: category.id, subtype_id: subtype.id, title, status: "planned" })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${title} failed`);

  const { error: linkError } = await user
    .from("item_links")
    .insert({ item_id: item.id, url: linkUrl, label: "Steam (manual)" });
  if (linkError) throw linkError;

  return item.id as string;
}

test.describe("Connections page: Steam import (issue #62)", () => {
  test("Connections nav entry appears between Custom Lists and Settings, desktop and mobile", async ({
    page,
  }) => {
    const email = randomTestEmail("connections-nav");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      const sidebar = page.locator("aside");
      const labels = await sidebar.getByRole("link").allTextContents();
      const listsIdx = labels.indexOf("Custom Lists");
      const connectionsIdx = labels.indexOf("Connections");
      const settingsIdx = labels.indexOf("Settings");
      expect(listsIdx).toBeGreaterThanOrEqual(0);
      expect(connectionsIdx).toBe(listsIdx + 1);
      expect(settingsIdx).toBe(connectionsIdx + 1);

      await sidebar.getByRole("link", { name: "Connections", exact: true }).click();
      await page.waitForURL("**/connections");
      await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Steam", exact: true })).toBeVisible();

      // Mobile: same relative ordering inside the slide-out panel.
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/dashboard");
      await page.getByRole("button", { name: /open navigation/i }).click();
      const panel = page.locator("#mobile-nav-panel");
      const mobileLabels = await panel.getByRole("link").allTextContents();
      const mListsIdx = mobileLabels.indexOf("Custom Lists");
      const mConnectionsIdx = mobileLabels.indexOf("Connections");
      const mSettingsIdx = mobileLabels.indexOf("Settings");
      expect(mConnectionsIdx).toBe(mListsIdx + 1);
      expect(mSettingsIdx).toBe(mConnectionsIdx + 1);
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("live Steam lookup, duplicate marking, selection, partial-failure import, and Download JSON, all against the real Steam API/CDN", async ({
    page,
  }) => {
    // Real network calls to Steam (lookup + two CDN cover fetches) on top
    // of registration and DB verification -- comfortably above the
    // default budget. 150s (not just double, like add-item.spec.ts's
    // heaviest test) because this is real, uncontrolled third-party
    // latency (Steam's API/CDN), not just local dev-server contention --
    // confirmed to pass in ~50s standalone but needs real headroom when
    // fullyParallel runs it alongside this file's other two specs sharing
    // the one dev server.
    test.setTimeout(150_000);

    const email = randomTestEmail("connections-steam");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      // Pre-seed a manually-added link for Counter-Strike (appid 10) with a
      // URL that deliberately does NOT match what this app's own import
      // would generate (different scheme/case, trailing query string) --
      // proving the substring match, not exact-URL equality, is what
      // drives "Already in library" (issue #62 AC).
      await insertSeedItemWithLink(
        user,
        userId,
        "Counter-Strike (added manually)",
        "http://STORE.steampowered.com/app/10?snr=1_a_b",
      );

      await page.goto("/connections");

      await page.getByLabel(/steam profile name or steamid64/i).fill("garry");
      await page.getByRole("button", { name: /look up games/i }).click();

      // Real live Steam API round trip -- generous timeout.
      const csRow = page.getByRole("checkbox", { name: "Add Counter-Strike", exact: true }).locator("..");
      await expect(page.getByRole("checkbox", { name: "Add Counter-Strike", exact: true })).toBeVisible({
        timeout: 30_000,
      });

      // Duplicate marking: unchecked, disabled, and labeled -- for context,
      // not hidden entirely (issue #62 AC).
      const csCheckbox = page.getByRole("checkbox", { name: "Add Counter-Strike", exact: true });
      await expect(csCheckbox).toBeDisabled();
      await expect(csCheckbox).not.toBeChecked();
      await expect(csRow.getByText("Already in library")).toBeVisible();

      // Nothing pre-selected by default (issue #62 Goal: "reviewed and
      // selected item-by-item, not a blind bulk import" -- especially
      // relevant here, since this real profile has ~496 games).
      await expect(page.getByRole("button", { name: /^add \d+ selected/i })).toBeDisabled();

      // Select two real, live-verified games: one whose cover fetch fully
      // succeeds, one whose cover fetch genuinely fails on both CDN URLs.
      await page.getByRole("checkbox", { name: "Add Team Fortress Classic", exact: true }).check();
      await page.getByRole("checkbox", { name: "Add SteamOS Devkit Client", exact: true }).check();
      await expect(page.getByRole("button", { name: "Add 2 selected games" })).toBeEnabled();

      // Download JSON: entirely client-side, from the same lookup already
      // in memory -- no second server round trip (issue #62 AC).
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: /download json/i }).click(),
      ]);
      const downloadPath = await download.path();
      if (!downloadPath) throw new Error("download produced no local path");
      const fs = await import("node:fs/promises");
      const raw = JSON.parse(await fs.readFile(downloadPath, "utf-8")) as {
        steamId: string;
        games: { appid: number; name: string; playtime_forever: number }[];
      };
      expect(raw.steamId).toBe("76561197960279927");
      expect(raw.games.length).toBeGreaterThan(400); // the real ~496-game response
      expect(raw.games).toEqual(
        expect.arrayContaining([expect.objectContaining({ appid: 10, name: "Counter-Strike" })]),
      );

      // Submit the import -- real inserts, real Steam CDN cover fetches.
      await page.getByRole("button", { name: "Add 2 selected games" }).click();

      await expect(page.getByText(/2 games added \(1 without a cover image\)\./)).toBeVisible({
        timeout: 30_000,
      });

      // Verify directly against the live DB: both items exist, in the
      // Games category with the predefined "Other" subtype and status
      // planned (issue #62 AC), each with its Steam store link attached
      // regardless of whether the cover succeeded.
      const { data: category } = await user.from("categories").select("id").eq("slug", "games").single();
      const { data: items } = await user
        .from("items")
        .select("id, title, status, category_id, subtypes ( name )")
        .in("title", ["Team Fortress Classic", "SteamOS Devkit Client"]);
      expect(items).toHaveLength(2);
      for (const item of items ?? []) {
        expect(item.status).toBe("planned");
        expect(item.category_id).toBe(category?.id);
      }

      const tfc = items?.find((item) => item.title === "Team Fortress Classic");
      const devkit = items?.find((item) => item.title === "SteamOS Devkit Client");
      if (!tfc || !devkit) throw new Error("expected both imported items to exist");

      const { data: tfcLinks } = await user.from("item_links").select("url, label").eq("item_id", tfc.id);
      expect(tfcLinks).toEqual([
        expect.objectContaining({ url: "https://store.steampowered.com/app/20/", label: "Steam" }),
      ]);
      const { data: tfcImages } = await user.from("item_images").select("id").eq("item_id", tfc.id);
      expect(tfcImages).toHaveLength(1); // cover fetch succeeded

      const { data: devkitLinks } = await user
        .from("item_links")
        .select("url, label")
        .eq("item_id", devkit.id);
      expect(devkitLinks).toEqual([
        expect.objectContaining({ url: "https://store.steampowered.com/app/943760/", label: "Steam" }),
      ]);
      const { data: devkitImages } = await user.from("item_images").select("id").eq("item_id", devkit.id);
      // Cover fetch genuinely 404s on both CDN URLs for this real appid --
      // the item itself must still exist (asserted above), just with no
      // cover (issue #62 AC: a cover failure never blocks/rolls back the
      // item).
      expect(devkitImages).toHaveLength(0);

      // Repeatable flow (issue #62 AC): looking the same account up again
      // clears the previous selection/result and re-computes duplicate
      // marking fresh -- the just-imported Team Fortress Classic must now
      // itself show "Already in library".
      //
      // The picker's rows aren't unmounted while the new lookup is
      // pending (same checkbox aria-label persists from the first lookup
      // until the second one's data replaces it), so a plain toBeVisible
      // check would pass instantly against the *stale* first-lookup row --
      // it's the toBeDisabled check below that actually proves the second,
      // fresh lookup landed, so it needs the same generous real-network
      // timeout as every other live Steam round trip in this test, not
      // Playwright's 5s default (this genuinely flaked once at 5s under
      // 3-way parallel worker contention, all hitting Steam at once).
      await page.getByLabel(/steam profile name or steamid64/i).fill("garry");
      await page.getByRole("button", { name: /look up games/i }).click();
      await expect(
        page.getByRole("checkbox", { name: "Add Team Fortress Classic", exact: true }),
      ).toBeDisabled({ timeout: 30_000 });
      await expect(
        page.getByText(/2 games added \(1 without a cover image\)\./),
      ).toHaveCount(0); // previous import summary cleared, not left over
      await expect(page.getByRole("button", { name: /^add \d+ selected/i })).toBeDisabled(); // selection reset to empty

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a private/nonexistent profile shows the privacy-specific error, not a generic failure", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const email = randomTestEmail("connections-private");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);
      await page.goto("/connections");

      // Gabe Newell's own vanity URL -- confirmed live during grooming/QA
      // to resolve successfully (ResolveVanityURL succeeds) but return an
      // empty {response:{}} from GetOwnedGames (his "Game details" privacy
      // is not Public) -- exactly the case this error message is for.
      await page.getByLabel(/steam profile name or steamid64/i).fill("gabelogannewell");
      await page.getByRole("button", { name: /look up games/i }).click();

      await expect(page.getByText(/game details.*public/i)).toBeVisible({ timeout: 30_000 });
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
