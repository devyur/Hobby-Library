"use server";

import { attachSteamCoverAction } from "@/lib/actions/covers";
import { addLinkAction } from "@/lib/actions/links";
import { insertItemRow } from "@/lib/actions/items";
import { createClient } from "@/lib/supabase/server";
import {
  initialSteamImportState,
  initialSteamLookupState,
  type SteamImportActionState,
  type SteamImportFailure,
  type SteamLookupActionState,
  type SteamPickerGame,
  type SteamRawGame,
} from "@/lib/validation/steam";

// Steam Web API base (issue #62's Background/Constraints, confirmed live
// during grooming): api.steampowered.com, NOT partner.steam-api.com (a
// separate Steamworks-partner surface that takes a different key type).
const STEAM_API_BASE = "https://api.steampowered.com";

const PRIVACY_ERROR =
  "This Steam profile's games aren't visible to this app. Ask the profile owner to open Steam, go to Edit Profile > Privacy Settings, and set \"Game details\" to Public (even temporarily), then try again.";

const CONFIG_ERROR =
  "Steam import isn't set up yet -- ask the app owner to add a STEAM_API_KEY.";

// A raw SteamID64 is a 17-digit numeric string; anything else is treated as
// a vanity URL name and resolved first (issue #62 AC). Deliberately loose
// (any all-digit string, not strictly length-17) -- Valve's own ID space
// could in principle grow, and this only decides which of the two lookup
// paths to take, never parses the digits itself.
function isNumericSteamId(identifier: string): boolean {
  return /^\d+$/.test(identifier);
}

async function resolveVanityUrl(
  vanityUrl: string,
  apiKey: string,
): Promise<{ steamId: string } | { error: string }> {
  const url = `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(vanityUrl)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { error: "Couldn't reach Steam right now. Please try again." };
  }

  if (!response.ok) {
    return { error: "Couldn't reach Steam right now. Please try again." };
  }

  const body = (await response.json()) as {
    response?: { success?: number; steamid?: string; message?: string };
  };

  // success === 1 is the only "found" code (issue #62 AC) -- any other
  // value (commonly 42, "No match") means no such vanity URL.
  if (body.response?.success === 1 && body.response.steamid) {
    return { steamId: body.response.steamid };
  }

  return {
    error: `No Steam profile was found for "${vanityUrl}". Double-check the vanity URL name, or use the profile's numeric SteamID64 instead.`,
  };
}

async function fetchOwnedGames(
  steamId: string,
  apiKey: string,
): Promise<{ games: SteamRawGame[] } | { error: string }> {
  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&format=json`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { error: "Couldn't reach Steam right now. Please try again." };
  }

  // GetOwnedGames returns a non-200 for a nonexistent/invalid steamid --
  // lumped in with the private-profile message below (issue #62 AC groups
  // both under "profile/game-details are private... or an explicit HTTP
  // error") since this app has no way to tell the two apart from the
  // response alone, and both point the user at the same fix: double-check
  // the identifier and its Steam privacy settings.
  if (!response.ok) {
    return { error: PRIVACY_ERROR };
  }

  const body = (await response.json()) as {
    response?: { game_count?: number; games?: SteamRawGame[] };
  };

  const games = body.response?.games;
  // No games array, or an empty one, both mean the same thing here: either
  // "Game details" is not Public, or the account genuinely owns nothing --
  // this app can't distinguish those two, so it always surfaces the
  // actionable privacy-setting explanation rather than a generic failure
  // (issue #62 AC).
  if (!games || games.length === 0) {
    return { error: PRIVACY_ERROR };
  }

  return { games };
}

// Server Action backing SteamConnectionCard.tsx's lookup form (issue #62).
// Resolves a vanity URL or accepts a raw SteamID64, fetches the profile's
// owned games, and marks each one "already in library" against this user's
// own item_links -- computed fresh on every call (never cached), so a
// second lookup (a different account, or the same one again) never carries
// stale duplicate-marking from a previous call, per the issue's "repeatable
// flow" AC.
//
// Steam's Web API key has a ~100k calls/day rate limit (issue #62's
// Constraints) -- this costs at most 2 calls (resolve + get-owned-games),
// a non-issue for a single-user app.
export async function lookupSteamGamesAction(
  _prevState: SteamLookupActionState,
  formData: FormData,
): Promise<SteamLookupActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) {
    return { ...initialSteamLookupState, error: "Enter a Steam profile name or SteamID64." };
  }

  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    return { ...initialSteamLookupState, error: CONFIG_ERROR };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- proxy.ts already redirects an unauthenticated
    // request to /login before this route/action is ever reachable.
    return { ...initialSteamLookupState, error: "You must be signed in to import from Steam." };
  }

  let steamId: string;
  if (isNumericSteamId(identifier)) {
    steamId = identifier;
  } else {
    const resolved = await resolveVanityUrl(identifier, apiKey);
    if ("error" in resolved) {
      return { ...initialSteamLookupState, error: resolved.error };
    }
    steamId = resolved.steamId;
  }

  const ownedGames = await fetchOwnedGames(steamId, apiKey);
  if ("error" in ownedGames) {
    return { ...initialSteamLookupState, error: ownedGames.error };
  }

  // Duplicate detection (issue #62 AC): every item_links row belonging to
  // this user, matched against each game by a "/app/<appid>" substring --
  // not exact URL equality -- so a manually-added link with a different
  // scheme, trailing slash, or ?snr=... tracking query string still counts.
  // Fetched as one query (via items -> item_links, the same embedded-select
  // shape lib/queries/items.ts/export.ts already use) rather than one ILIKE
  // round trip per game -- functionally equivalent substring matching, done
  // in memory instead of N separate queries.
  const { data: itemRows } = await supabase
    .from("items")
    .select("item_links ( url )")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  const existingLinkUrls: string[] = [];
  for (const row of itemRows ?? []) {
    const links = Array.isArray(row.item_links) ? row.item_links : [];
    for (const link of links) {
      if (typeof link.url === "string") existingLinkUrls.push(link.url.toLowerCase());
    }
  }

  const games: SteamPickerGame[] = ownedGames.games.map((game) => {
    const needle = `/app/${game.appid}`;
    const alreadyInLibrary = existingLinkUrls.some((url) => url.includes(needle));
    return { appid: game.appid, name: game.name, alreadyInLibrary };
  });

  return { error: null, steamId, games, rawGames: ownedGames.games };
}

// Server Action backing SteamConnectionCard.tsx's "Add selected" button
// (issue #62). Takes the games the user checked (appid + name only -- the
// rest of the raw Steam payload never needs to reach this action) and
// creates one item per game, continuing through per-game failures rather
// than stopping or rolling back (issue #62 AC): a cover-fetch failure for
// one game must never block or undo the others.
export async function importSteamGamesAction(
  games: { appid: number; name: string }[],
): Promise<SteamImportActionState> {
  if (games.length === 0) {
    return { ...initialSteamImportState, error: "Select at least one game to add." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ...initialSteamImportState, error: "You must be signed in to import from Steam." };
  }

  // Games category resolved by name at runtime, never a hardcoded id/slug
  // (AGENTS.md; issue #62 AC) -- same "runtime lookup by a known name"
  // approach quickAddItemAction already uses for the "Other" subtype below.
  const { data: category } = await supabase
    .from("categories")
    .select("id, slug")
    .eq("slug", "games")
    .maybeSingle();
  if (!category) {
    return {
      ...initialSteamImportState,
      error: "The Games category isn't set up yet, so Steam import can't be used right now.",
    };
  }

  // The predefined "Other" subtype -- Steam imports carry no subtype input
  // of their own, same resolution quickAddItemAction (lib/actions/items.ts)
  // already performs for the same reason.
  const { data: otherSubtype } = await supabase
    .from("subtypes")
    .select("id")
    .eq("category_id", category.id)
    .is("user_id", null)
    .eq("name", "Other")
    .maybeSingle();
  if (!otherSubtype) {
    return {
      ...initialSteamImportState,
      error: "The Games category doesn't have a default subtype set up yet, so Steam import can't be used right now.",
    };
  }

  let imported = 0;
  let importedWithoutCover = 0;
  const failed: SteamImportFailure[] = [];

  for (const game of games) {
    const insertResult = await insertItemRow(supabase, {
      userId: user.id,
      categoryId: category.id,
      subtypeId: otherSubtype.id,
      title: game.name,
      status: "planned",
    });

    if ("error" in insertResult) {
      const reason =
        insertResult.error === "subtype_category_mismatch"
          ? "Something went wrong creating this item. Please try again."
          : insertResult.error;
      failed.push({ name: game.name, reason });
      continue;
    }

    const itemId = insertResult.item.id;

    // Store link (issue #62 AC) -- addLinkAction is reused exactly as-is,
    // no changes to lib/actions/links.ts. A trailing slash matches Steam's
    // own real store-page URL convention; duplicate detection above matches
    // on a "/app/<appid>" substring regardless, so this exact form doesn't
    // matter for future re-lookups.
    await addLinkAction(itemId, `https://store.steampowered.com/app/${game.appid}/`, "Steam");

    // Cover is optional and never blocks the item itself (issue #62 AC) --
    // matches CoverThumbnail.tsx's existing "no cover is a valid state, not
    // an error" resilience. A failure here only changes which counter this
    // game lands in below, never removes or skips the item just created.
    const coverResult = await attachSteamCoverAction(supabase, user.id, itemId, game.appid);
    if ("error" in coverResult) {
      importedWithoutCover += 1;
    }
    imported += 1;
  }

  return {
    error: null,
    result: { imported, importedWithoutCover, failed },
  };
}
