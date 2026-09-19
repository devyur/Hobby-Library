import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/steam.ts (issue #62). Live behavior against
// the real Steam Web API/CDN was verified separately (see the issue's QA
// notes) -- this suite instead covers what a live run can't force/isolate
// on demand: the numeric-vs-vanity identifier branch, every distinct error
// message (missing key, unauthenticated, vanity-not-found, private/empty
// profile, an HTTP error from GetOwnedGames), the duplicate-marking
// substring match against item_links, and importSteamGamesAction's
// per-game continue-through-failure behavior (a cover failure/insert
// failure for one game must never block or roll back another). Same
// createClient-mocking shape as lib/actions/items.test.ts/import.test.ts;
// insertItemRow/addLinkAction/attachSteamCoverAction are mocked at the
// module level (their own behavior is covered by items.test.ts/
// links.test.ts/covers.test.ts respectively) so this suite only asserts
// that steam.ts calls them correctly and aggregates their results right.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const insertItemRowMock = vi.fn();
vi.mock("@/lib/actions/items", () => ({
  insertItemRow: (...args: unknown[]) => insertItemRowMock(...args),
}));

const addLinkActionMock = vi.fn();
vi.mock("@/lib/actions/links", () => ({
  addLinkAction: (...args: unknown[]) => addLinkActionMock(...args),
}));

const attachSteamCoverActionMock = vi.fn();
vi.mock("@/lib/actions/covers", () => ({
  attachSteamCoverAction: (...args: unknown[]) => attachSteamCoverActionMock(...args),
}));

const { lookupSteamGamesAction, importSteamGamesAction } = await import("./steam");

type FakeRow = Record<string, unknown> | null;

function fakeFetchJson(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function fakeLookupSupabase(options: {
  user?: { id: string } | null;
  itemRows?: { item_links: { url: string }[] }[];
}) {
  const fromMock = vi.fn((table: string) => {
    if (table === "items") {
      return {
        select: () => ({
          eq: () => ({
            is: async () => ({ data: options.itemRows ?? [] }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
  };
}

function fakeImportSupabase(options: {
  user?: { id: string } | null;
  category?: FakeRow;
  otherSubtype?: FakeRow;
}) {
  const fromMock = vi.fn((table: string) => {
    if (table === "categories") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.category ?? null }) }) }) };
    }
    if (table === "subtypes") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: options.otherSubtype ?? null }) }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
  };
}

function formDataWithIdentifier(identifier: string): FormData {
  const formData = new FormData();
  formData.set("identifier", identifier);
  return formData;
}

const initialLookupState = { error: null, steamId: null, games: null, rawGames: null };

describe("lookupSteamGamesAction", () => {
  const originalKey = process.env.STEAM_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    createClientMock.mockReset();
    process.env.STEAM_API_KEY = "test-key";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env.STEAM_API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  it("rejects an empty identifier without calling createClient", async () => {
    const result = await lookupSteamGamesAction(initialLookupState, formDataWithIdentifier("  "));
    expect(result.error).toMatch(/enter a steam profile/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects when STEAM_API_KEY isn't configured, without calling createClient", async () => {
    delete process.env.STEAM_API_KEY;
    const result = await lookupSteamGamesAction(initialLookupState, formDataWithIdentifier("someuser"));
    expect(result.error).toMatch(/steam_api_key/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const supabase = fakeLookupSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await lookupSteamGamesAction(initialLookupState, formDataWithIdentifier("someuser"));
    expect(result.error).toMatch(/signed in/i);
  });

  it("skips ResolveVanityURL for a purely numeric identifier, calling GetOwnedGames directly", async () => {
    const supabase = fakeLookupSupabase({ user: { id: "user-1" }, itemRows: [] });
    createClientMock.mockResolvedValue(supabase);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fakeFetchJson({ response: { game_count: 1, games: [{ appid: 10, name: "Counter-Strike", playtime_forever: 5 }] } }),
    );

    const result = await lookupSteamGamesAction(
      initialLookupState,
      formDataWithIdentifier("76561197960279927"),
    );

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("GetOwnedGames");
    expect(result.steamId).toBe("76561197960279927");
    expect(result.games).toEqual([{ appid: 10, name: "Counter-Strike", alreadyInLibrary: false }]);
  });

  it("resolves a non-numeric identifier via ResolveVanityURL first", async () => {
    const supabase = fakeLookupSupabase({ user: { id: "user-1" }, itemRows: [] });
    createClientMock.mockResolvedValue(supabase);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(fakeFetchJson({ response: { success: 1, steamid: "76561197960279927" } }))
      .mockResolvedValueOnce(
        fakeFetchJson({ response: { game_count: 1, games: [{ appid: 10, name: "Counter-Strike", playtime_forever: 0 }] } }),
      );

    const result = await lookupSteamGamesAction(initialLookupState, formDataWithIdentifier("garry"));

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("ResolveVanityURL");
    expect(String(fetchMock.mock.calls[0][0])).toContain("vanityurl=garry");
    expect(result.steamId).toBe("76561197960279927");
  });

  it("surfaces a clear error when ResolveVanityURL finds no match (success !== 1), never calling GetOwnedGames", async () => {
    const supabase = fakeLookupSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(fakeFetchJson({ response: { success: 42 } }));

    const result = await lookupSteamGamesAction(initialLookupState, formDataWithIdentifier("no-such-user"));

    expect(result.error).toMatch(/no steam profile was found/i);
    expect(result.games).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the privacy-specific error when GetOwnedGames returns no games array (private profile)", async () => {
    const supabase = fakeLookupSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(fakeFetchJson({ response: {} }));

    const result = await lookupSteamGamesAction(
      initialLookupState,
      formDataWithIdentifier("76561197960287930"),
    );

    expect(result.error).toMatch(/game details.*public/i);
    expect(result.games).toBeNull();
  });

  it("surfaces the same privacy-specific error on an explicit HTTP error from GetOwnedGames", async () => {
    const supabase = fakeLookupSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(fakeFetchJson({}, false, 500));

    const result = await lookupSteamGamesAction(
      initialLookupState,
      formDataWithIdentifier("76561197960287930"),
    );

    expect(result.error).toMatch(/game details.*public/i);
  });

  it("marks a game already in the library via a /app/<appid> substring match against item_links, not exact equality", async () => {
    const supabase = fakeLookupSupabase({
      user: { id: "user-1" },
      itemRows: [
        // Deliberately not an exact match to what importSteamGamesAction
        // itself would write (trailing slash / different scheme / a
        // tracking query string) -- issue #62 AC's whole point is that
        // this still counts as the same game.
        { item_links: [{ url: "http://STORE.steampowered.com/app/10?snr=1_a_b" }] },
      ],
    });
    createClientMock.mockResolvedValue(supabase);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fakeFetchJson({
        response: {
          game_count: 2,
          games: [
            { appid: 10, name: "Counter-Strike", playtime_forever: 0 },
            { appid: 20, name: "Team Fortress Classic", playtime_forever: 0 },
          ],
        },
      }),
    );

    const result = await lookupSteamGamesAction(
      initialLookupState,
      formDataWithIdentifier("76561197960279927"),
    );

    expect(result.games).toEqual([
      { appid: 10, name: "Counter-Strike", alreadyInLibrary: true },
      { appid: 20, name: "Team Fortress Classic", alreadyInLibrary: false },
    ]);
  });

  it("returns the untouched raw per-game Steam payload alongside the picker projection, for the Download JSON button", async () => {
    const supabase = fakeLookupSupabase({ user: { id: "user-1" }, itemRows: [] });
    createClientMock.mockResolvedValue(supabase);

    const rawGame = { appid: 10, name: "Counter-Strike", playtime_forever: 42, rtime_last_played: 123, img_icon_url: "abc" };
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(fakeFetchJson({ response: { game_count: 1, games: [rawGame] } }));

    const result = await lookupSteamGamesAction(
      initialLookupState,
      formDataWithIdentifier("76561197960279927"),
    );

    expect(result.rawGames).toEqual([rawGame]);
  });
});

describe("importSteamGamesAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    insertItemRowMock.mockReset();
    addLinkActionMock.mockReset();
    attachSteamCoverActionMock.mockReset();
  });

  it("rejects an empty selection without calling createClient", async () => {
    const result = await importSteamGamesAction([]);
    expect(result.error).toMatch(/select at least one/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const supabase = fakeImportSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await importSteamGamesAction([{ appid: 10, name: "Counter-Strike" }]);
    expect(result.error).toMatch(/signed in/i);
  });

  it("returns a clean error when the Games category isn't resolvable, without ever calling insertItemRow", async () => {
    const supabase = fakeImportSupabase({ user: { id: "user-1" }, category: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await importSteamGamesAction([{ appid: 10, name: "Counter-Strike" }]);
    expect(result.error).toMatch(/games category/i);
    expect(insertItemRowMock).not.toHaveBeenCalled();
  });

  it("returns a clean error when the 'Other' subtype isn't resolvable, without ever calling insertItemRow", async () => {
    const supabase = fakeImportSupabase({
      user: { id: "user-1" },
      category: { id: "cat-games", slug: "games" },
      otherSubtype: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await importSteamGamesAction([{ appid: 10, name: "Counter-Strike" }]);
    expect(result.error).toMatch(/default subtype/i);
    expect(insertItemRowMock).not.toHaveBeenCalled();
  });

  it("creates an item, attaches the Steam store link, and attaches a cover for a fully-successful game", async () => {
    const supabase = fakeImportSupabase({
      user: { id: "user-1" },
      category: { id: "cat-games", slug: "games" },
      otherSubtype: { id: "subtype-other" },
    });
    createClientMock.mockResolvedValue(supabase);
    insertItemRowMock.mockResolvedValue({ item: { id: "item-1" } });
    addLinkActionMock.mockResolvedValue({ link: { id: "link-1", url: "x", label: "Steam" } });
    attachSteamCoverActionMock.mockResolvedValue({ success: true });

    const result = await importSteamGamesAction([{ appid: 10, name: "Counter-Strike" }]);

    expect(insertItemRowMock).toHaveBeenCalledWith(supabase, {
      userId: "user-1",
      categoryId: "cat-games",
      subtypeId: "subtype-other",
      title: "Counter-Strike",
      status: "planned",
    });
    expect(addLinkActionMock).toHaveBeenCalledWith(
      "item-1",
      "https://store.steampowered.com/app/10/",
      "Steam",
    );
    expect(attachSteamCoverActionMock).toHaveBeenCalledWith(supabase, "user-1", "item-1", 10);
    expect(result.result).toEqual({ imported: 1, importedWithoutCover: 0, failed: [] });
  });

  it("a cover-fetch failure for one game still creates its item (without a cover) and never blocks/rolls back other games", async () => {
    const supabase = fakeImportSupabase({
      user: { id: "user-1" },
      category: { id: "cat-games", slug: "games" },
      otherSubtype: { id: "subtype-other" },
    });
    createClientMock.mockResolvedValue(supabase);
    insertItemRowMock
      .mockResolvedValueOnce({ item: { id: "item-1" } })
      .mockResolvedValueOnce({ item: { id: "item-2" } });
    addLinkActionMock.mockResolvedValue({ link: { id: "link-1", url: "x", label: "Steam" } });
    attachSteamCoverActionMock
      .mockResolvedValueOnce({ error: "Steam has no cover image available for this game." })
      .mockResolvedValueOnce({ success: true });

    const result = await importSteamGamesAction([
      { appid: 999999999, name: "No Cover Game" },
      { appid: 20, name: "Team Fortress Classic" },
    ]);

    expect(insertItemRowMock).toHaveBeenCalledTimes(2);
    expect(result.result).toEqual({ imported: 2, importedWithoutCover: 1, failed: [] });
  });

  it("an item-insert failure for one game is recorded as a failure and doesn't stop the rest", async () => {
    const supabase = fakeImportSupabase({
      user: { id: "user-1" },
      category: { id: "cat-games", slug: "games" },
      otherSubtype: { id: "subtype-other" },
    });
    createClientMock.mockResolvedValue(supabase);
    insertItemRowMock
      .mockResolvedValueOnce({ error: "db exploded" })
      .mockResolvedValueOnce({ item: { id: "item-2" } });
    addLinkActionMock.mockResolvedValue({ link: { id: "link-1", url: "x", label: "Steam" } });
    attachSteamCoverActionMock.mockResolvedValue({ success: true });

    const result = await importSteamGamesAction([
      { appid: 10, name: "Broken Game" },
      { appid: 20, name: "Team Fortress Classic" },
    ]);

    expect(result.result).toEqual({
      imported: 1,
      importedWithoutCover: 0,
      failed: [{ name: "Broken Game", reason: "db exploded" }],
    });
    // The failed game's appid never reached addLinkAction/attachSteamCoverAction.
    expect(addLinkActionMock).toHaveBeenCalledTimes(1);
    expect(attachSteamCoverActionMock).toHaveBeenCalledTimes(1);
  });
});
