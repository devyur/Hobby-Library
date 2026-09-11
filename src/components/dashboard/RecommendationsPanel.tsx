"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { PriorityBadge } from "@/components/items/PriorityBadge";
import { RatingBadge } from "@/components/items/RatingBadge";
import { StatusPill } from "@/components/items/StatusPill";
import { TagChips } from "@/components/items/TagChips";
import {
  dismissRecommendationAction,
  rerollRandomPlannedAction,
  undismissRecommendationAction,
} from "@/lib/actions/recommendations";
import type { RecommendationItem, RecommendationsData } from "@/lib/queries/dashboard";

// Client Component boundary for Recommendations' interactive parts (issue
// #44) -- following the client/server split precedent #39 established with
// sortDirection.ts/LibraryView.tsx: RecommendationsSection.tsx (a Server
// Component) still does the one server-rendered fetch (getRecommendations,
// lib/queries/dashboard.ts), then hands the result to this Client
// Component as `initialData`, which owns all local state from there on --
// same "server read once, client owns the list after that" shape
// TrashList.tsx (issue #25) already uses for Restore/Permanent Delete,
// reused here for Dismiss/Undo, plus Shuffle for the Random pick group.
//
// Three local arrays/values (recommendedPlanned/randomPlanned/
// continueOngoing) mirror RecommendationsData's three groups -- Dismiss
// removes an item from whichever one it belongs to; Random pick's own
// dismiss additionally re-rolls a replacement (rerollRandomPlannedAction),
// same action Shuffle itself calls.
//
// Dismiss/Undo await their Server Action before touching local state
// (never optimistic-before-confirmation) -- same pattern TrashList.tsx uses
// for Restore/Permanent Delete, chosen over LibraryView's
// optimistic-then-fire-and-forget pattern because Undo's correctness
// depends on the dismiss having actually persisted.

type RecommendationGroupName = "recommendedPlanned" | "randomPlanned" | "continueOngoing";

interface UndoState {
  item: RecommendationItem;
  group: RecommendationGroupName;
  // Position to reinsert at for the two list groups; ignored for
  // randomPlanned (there's only ever one slot, and undoing it means
  // restoring this exact item as the current pick, discarding whatever
  // auto-replacement/shuffle result is showing at the moment).
  index: number;
}

// How long the inline "Undo" affordance stays available after a dismiss
// (issue #44: "an immediate way to undo... Once that immediate undo is
// gone (dismissed itself, or its window expires), reversing the dismiss is
// out of scope"). A manual dismiss of the undo banner itself, or dismissing
// a second item, also clears it early -- see handleUndo/handleDismiss.
const UNDO_WINDOW_MS = 8000;

const DEFAULT_EMPTY_MESSAGE =
  "No recommendations yet — add a few items to your library to see suggestions here.";
// Distinct from the message above (issue #44's own acceptance criteria) --
// shown only once a dismiss in *this* session is what emptied every group,
// never on a brand-new account that has simply never had anything to
// recommend.
const DISMISSED_EMPTY_MESSAGE =
  "No recommendations left — you've dismissed everything currently eligible. Add or update items, or check back later for new picks.";

export function RecommendationsPanel({ initialData }: { initialData: RecommendationsData }) {
  const [recommendedPlanned, setRecommendedPlanned] = useState<RecommendationItem[]>(
    initialData.recommendedPlanned,
  );
  const [randomPlanned, setRandomPlanned] = useState<RecommendationItem | null>(
    initialData.randomPlanned,
  );
  const [continueOngoing, setContinueOngoing] = useState<RecommendationItem[]>(
    initialData.continueOngoing,
  );

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  // True once a dismiss has actually succeeded this session -- drives which
  // of the two empty-state messages above applies once every group is
  // empty. Never reset back to false (a session that dismissed its way to
  // empty stays in the "distinct message" state even if the user then
  // navigates away and back within the same page load).
  const [hasDismissedSomething, setHasDismissedSomething] = useState(false);
  const [, startTransition] = useTransition();

  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearUndoTimer() {
    if (undoTimeoutRef.current !== null) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
  }

  function scheduleUndoExpiry() {
    clearUndoTimer();
    undoTimeoutRef.current = setTimeout(() => {
      setUndoState(null);
      undoTimeoutRef.current = null;
    }, UNDO_WINDOW_MS);
  }

  function handleDismiss(item: RecommendationItem, group: RecommendationGroupName) {
    setErrorMessage(null);
    setPendingId(item.id);

    startTransition(async () => {
      const result = await dismissRecommendationAction(item.id);
      setPendingId(null);

      if ("error" in result) {
        setErrorMessage(result.error);
        return;
      }

      let index = -1;
      if (group === "recommendedPlanned") {
        index = recommendedPlanned.findIndex((row) => row.id === item.id);
        setRecommendedPlanned((current) => current.filter((row) => row.id !== item.id));
      } else if (group === "continueOngoing") {
        index = continueOngoing.findIndex((row) => row.id === item.id);
        setContinueOngoing((current) => current.filter((row) => row.id !== item.id));
      } else {
        setRandomPlanned(null);
      }

      setHasDismissedSomething(true);
      setUndoState({ item, group, index });
      scheduleUndoExpiry();

      // Random pick's own dismiss auto-replaces immediately (issue #44's
      // acceptance criteria) rather than leaving the group visibly empty --
      // same reroll the Shuffle button below triggers.
      if (group === "randomPlanned") {
        const next = await rerollRandomPlannedAction();
        setRandomPlanned(next);
      }
    });
  }

  function handleUndo() {
    if (!undoState) return;
    const { item, group, index } = undoState;

    clearUndoTimer();
    setUndoState(null);
    setErrorMessage(null);

    startTransition(async () => {
      const result = await undismissRecommendationAction(item.id);
      if ("error" in result) {
        setErrorMessage(result.error);
        return;
      }

      if (group === "recommendedPlanned") {
        setRecommendedPlanned((current) => insertAt(current, item, index));
      } else if (group === "continueOngoing") {
        setContinueOngoing((current) => insertAt(current, item, index));
      } else {
        // Restores the dismissed item as the current Random pick, discarding
        // whatever the auto-replacement/a later Shuffle happened to show.
        setRandomPlanned(item);
      }
    });
  }

  function handleShuffle() {
    setErrorMessage(null);
    setIsShuffling(true);
    startTransition(async () => {
      const next = await rerollRandomPlannedAction();
      setIsShuffling(false);
      setRandomPlanned(next);
    });
  }

  const allEmpty =
    recommendedPlanned.length === 0 && randomPlanned === null && continueOngoing.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">Recommendations</h2>
      {allEmpty ? (
        <p className="text-sm text-text-secondary">
          {hasDismissedSomething ? DISMISSED_EMPTY_MESSAGE : DEFAULT_EMPTY_MESSAGE}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {recommendedPlanned.length > 0 ? (
            <RecommendationGroup
              title="Recommended Planned"
              items={recommendedPlanned}
              pendingId={pendingId}
              onDismiss={(item) => handleDismiss(item, "recommendedPlanned")}
            />
          ) : null}
          {randomPlanned ? (
            <div aria-label="Random pick" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-text-primary">Random pick</h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isShuffling}
                  onClick={handleShuffle}
                >
                  Shuffle
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <RecommendationCard
                  item={randomPlanned}
                  isPending={pendingId === randomPlanned.id}
                  onDismiss={() => handleDismiss(randomPlanned, "randomPlanned")}
                />
              </div>
            </div>
          ) : null}
          {continueOngoing.length > 0 ? (
            <RecommendationGroup
              title="Continue"
              items={continueOngoing}
              pendingId={pendingId}
              onDismiss={(item) => handleDismiss(item, "continueOngoing")}
            />
          ) : null}
        </div>
      )}
      {undoState ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        >
          <span>Dismissed &quot;{undoState.item.title}&quot;.</span>
          <button
            type="button"
            className="font-medium text-accent underline underline-offset-2"
            onClick={handleUndo}
          >
            Undo
          </button>
        </div>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}

// Reinserts `item` back into `items` at `index` (clamped to the current
// array length -- other dismissals may have shortened the array since this
// item's own dismiss captured that index). Falls back to appending when the
// original index couldn't be determined (-1, defensive only).
function insertAt(
  items: RecommendationItem[],
  item: RecommendationItem,
  index: number,
): RecommendationItem[] {
  const next = [...items];
  const insertIndex = index < 0 ? next.length : Math.min(index, next.length);
  next.splice(insertIndex, 0, item);
  return next;
}

function RecommendationGroup({
  title,
  items,
  pendingId,
  onDismiss,
}: {
  title: string;
  items: RecommendationItem[];
  pendingId: string | null;
  onDismiss: (item: RecommendationItem) => void;
}) {
  return (
    <div aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <RecommendationCard
            key={item.id}
            item={item}
            isPending={pendingId === item.id}
            onDismiss={() => onDismiss(item)}
          />
        ))}
      </div>
    </div>
  );
}

function RecommendationCard({
  item,
  isPending,
  onDismiss,
}: {
  item: RecommendationItem;
  isPending: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="relative">
      <Link
        href={`/${item.categorySlug}/${item.id}`}
        className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 text-sm hover:border-accent"
      >
        <CoverThumbnail coverUrl={item.coverUrl} title={item.title} />
        <span className="truncate pr-5 font-medium text-text-primary">{item.title}</span>
        <div className="flex flex-wrap items-center gap-1">
          <RatingBadge rating={item.rating} />
          <StatusPill status={item.status} />
          <PriorityBadge status={item.status} priority={item.priority} />
        </div>
        <span className="truncate text-xs text-text-secondary">
          {item.categoryName} · {item.subtypeName}
        </span>
        <TagChips tags={item.tags} />
      </Link>
      <button
        type="button"
        aria-label={`Dismiss ${item.title}`}
        disabled={isPending}
        onClick={onDismiss}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-xs leading-none text-text-secondary shadow-xs hover:text-text-primary disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );
}
