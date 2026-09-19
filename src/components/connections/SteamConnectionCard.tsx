"use client";

import { useActionState, useId, useState, useTransition } from "react";
import type { ChangeEvent } from "react";

import { importSteamGamesAction, lookupSteamGamesAction } from "@/lib/actions/steam";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  initialSteamImportState,
  initialSteamLookupState,
  type SteamImportActionState,
} from "@/lib/validation/steam";

// Steam import card for the Connections page (issue #62) -- the first
// (currently only) service card; the page itself (page.tsx) is what leaves
// room for more of these later. Two Server Actions drive this:
// lookupSteamGamesAction (a real <form>/useActionState pair, same shape as
// ImportLibraryForm.tsx/CoverUploadControl.tsx -- there's real form input,
// the profile identifier) and importSteamGamesAction (called directly via
// useTransition, same shape as ItemTagsEditor.tsx's attach/detach calls --
// its input is the picker's in-memory selection, not a real form field).
export function SteamConnectionCard() {
  const [lookupState, lookupAction, isLookupPending] = useActionState(
    lookupSteamGamesAction,
    initialSteamLookupState,
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importState, setImportState] = useState<SteamImportActionState>(initialSteamImportState);
  const [isImportPending, startImportTransition] = useTransition();
  const identifierId = useId();
  const lookupErrorId = useId();
  const importErrorId = useId();

  // A new lookup result -- a different account, or the same one looked up
  // again -- fully replaces the picker's selection and clears any previous
  // import summary, rather than merging with or leaving behind state from a
  // prior lookup (issue #62 AC: "the whole flow works repeatably... without
  // any leftover state from the first lookup").
  //
  // Selection starts empty, not "every not-already-in-library game
  // pre-checked" -- the issue's own Goal is explicit that this is "reviewed
  // and selected item-by-item, not a blind bulk import," and a real account
  // can easily return several hundred games (confirmed live against a
  // public profile during verification), where pre-checking all of them
  // would make one click on "Add selected" indistinguishable from a blind
  // bulk import. The "Select all not in library" button below is the
  // opt-in shortcut for someone who does want everything.
  //
  // Adjusted during render (React's documented pattern for "state that
  // depends on a prop/earlier state changing"), not in a useEffect -- a
  // ref-tracked identity check lets this update selected/importState in the
  // same render lookupState.games changes in, with no extra render or
  // flash of stale state in between.
  const [trackedGames, setTrackedGames] = useState(lookupState.games);
  if (lookupState.games !== trackedGames) {
    setTrackedGames(lookupState.games);
    setSelected(new Set());
    setImportState(initialSteamImportState);
  }

  function toggleGame(appid: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(appid);
      else next.delete(appid);
      return next;
    });
  }

  function selectAllRemaining() {
    if (!lookupState.games) return;
    setSelected(
      new Set(lookupState.games.filter((game) => !game.alreadyInLibrary).map((game) => game.appid)),
    );
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleImport() {
    if (!lookupState.games) return;
    const chosen = lookupState.games
      .filter((game) => selected.has(game.appid))
      .map((game) => ({ appid: game.appid, name: game.name }));

    startImportTransition(async () => {
      const result = await importSteamGamesAction(chosen);
      setImportState(result);
    });
  }

  // Entirely client-side, from the data the picker already has in memory
  // (issue #62 AC) -- no second server round trip, and the raw per-game
  // fields Steam returned (playtime_forever, rtime_last_played, etc.) are
  // never persisted server-side beyond the one lookup fetch that produced
  // them.
  function handleDownloadJson() {
    if (!lookupState.rawGames) return;
    const payload = {
      steamId: lookupState.steamId,
      fetchedAt: new Date().toISOString(),
      games: lookupState.rawGames,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `steam-owned-games-${lookupState.steamId ?? "export"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const selectableCount = lookupState.games?.filter((game) => !game.alreadyInLibrary).length ?? 0;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Steam</h2>
        <p className="text-sm text-text-secondary">
          Import your owned games from a public Steam profile. This app never asks for your Steam
          password -- the profile&apos;s &quot;Game details&quot; privacy setting needs to be set
          to Public (even temporarily) before a lookup can see its games.
        </p>
      </div>

      <form action={lookupAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={identifierId}>Steam profile name or SteamID64</Label>
          <Input
            id={identifierId}
            name="identifier"
            placeholder="e.g. gabelogannewell"
            disabled={isLookupPending}
            aria-invalid={!!lookupState.error}
            aria-describedby={lookupState.error ? lookupErrorId : undefined}
          />
        </div>
        <Button type="submit" disabled={isLookupPending}>
          {isLookupPending ? "Looking up…" : "Look up games"}
        </Button>
      </form>

      {lookupState.error ? (
        <p id={lookupErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {lookupState.error}
        </p>
      ) : null}

      {lookupState.games ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-secondary">
              {lookupState.games.length} game{lookupState.games.length === 1 ? "" : "s"} found,{" "}
              {selectableCount} not yet in your library.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAllRemaining}
                disabled={selectableCount === 0}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSelection}
                disabled={selected.size === 0}
              >
                Clear
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleDownloadJson}>
                Download JSON
              </Button>
            </div>
          </div>

          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-md border border-border">
            {lookupState.games.map((game) => (
              <li
                key={game.appid}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <Checkbox
                  checked={selected.has(game.appid)}
                  disabled={game.alreadyInLibrary || isImportPending}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    toggleGame(game.appid, event.target.checked)
                  }
                  aria-label={`Add ${game.name}`}
                />
                {/* Picker thumbnail uses Steam's header.jpg CDN URL directly
                    (issue #62 AC) -- no pre-download/reprocessing of every
                    result before the user has chosen anything; only
                    submitted games ever get fetched server-side. Plain
                    <img>, same reasoning as CoverThumbnail.tsx: a
                    third-party CDN URL doesn't fit next/image's static
                    remotePatterns config for this single-consumer app. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`}
                  alt=""
                  loading="lazy"
                  className="h-10 w-24 shrink-0 rounded border border-border object-cover"
                />
                <span className="flex-1 text-sm text-text-primary">{game.name}</span>
                {game.alreadyInLibrary ? (
                  <span className="text-xs text-text-secondary">Already in library</span>
                ) : null}
              </li>
            ))}
          </ul>

          <div>
            <Button
              type="button"
              onClick={handleImport}
              disabled={isImportPending || selected.size === 0}
            >
              {isImportPending
                ? "Adding…"
                : `Add ${selected.size} selected game${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      ) : null}

      {importState.error ? (
        <p id={importErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {importState.error}
        </p>
      ) : null}

      {importState.result ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-text-primary">
            {importState.result.imported} game{importState.result.imported === 1 ? "" : "s"} added
            {importState.result.importedWithoutCover > 0
              ? ` (${importState.result.importedWithoutCover} without a cover image)`
              : ""}
            {importState.result.failed.length > 0
              ? `, ${importState.result.failed.length} failed`
              : ""}
            .
          </p>
          {importState.result.failed.length > 0 ? (
            <ul className="list-disc pl-5 text-text-secondary">
              {importState.result.failed.map((failure) => (
                <li key={failure.name}>
                  {failure.name} -- {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
