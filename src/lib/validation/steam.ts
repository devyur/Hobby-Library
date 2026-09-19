// Shared types/state for the Connections page's Steam import flow (issue
// #62), kept here rather than in lib/actions/steam.ts for the same reason
// ItemFormState/UploadCoverActionState live in lib/validation/*.ts instead
// of their own "use server" action files: a "use server" module may only
// export async functions, not plain types/consts.

// A single game exactly as Steam's GetOwnedGames returned it, kept as an
// open-ended record (not a narrow interface) so the "Download JSON" button
// (issue #62 AC) can serialize *everything* Steam sent back -- including
// fields this app never reads (img_icon_url, playtime_windows_forever,
// etc.) -- not just the handful of named fields below. appid/name/
// playtime_forever/rtime_last_played are typed explicitly since this app's
// own code reads them; everything else Steam might include rides along
// through the index signature untouched.
export interface SteamRawGame {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
  [key: string]: unknown;
}

// The picker-row projection of a raw game -- just what SteamGamePicker.tsx
// needs to render one row and decide its checkbox's initial state.
export interface SteamPickerGame {
  appid: number;
  name: string;
  alreadyInLibrary: boolean;
}

export type SteamLookupActionState = {
  error: string | null;
  steamId: string | null;
  games: SteamPickerGame[] | null;
  // The untouched Steam response, kept alongside the picker projection
  // above so "Download JSON" (issue #62 AC) can export it as-is, with no
  // second server round trip and no server-side persistence beyond this
  // one in-memory action result.
  rawGames: SteamRawGame[] | null;
};

export const initialSteamLookupState: SteamLookupActionState = {
  error: null,
  steamId: null,
  games: null,
  rawGames: null,
};

export interface SteamImportFailure {
  name: string;
  reason: string;
}

export interface SteamImportSummary {
  // Total items actually created (with or without a cover) -- the "12
  // imported" half of the issue's "12 imported, 1 failed: <name> --
  // couldn't fetch its cover image" example summary.
  imported: number;
  // Subset of `imported` that has no cover because attachSteamCoverAction
  // failed for it (issue #62 AC: a cover failure never blocks or rolls
  // back the item itself).
  importedWithoutCover: number;
  // Games whose *item* failed to create at all (category/subtype lookup
  // failure, or insertItemRow's own error) -- these are not counted in
  // `imported`.
  failed: SteamImportFailure[];
}

export type SteamImportActionState = {
  error: string | null;
  result: SteamImportSummary | null;
};

export const initialSteamImportState: SteamImportActionState = { error: null, result: null };
