"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { filterLibraryItemsAction } from "@/lib/actions/items";
import { updateDefaultSort, updateListViewMode } from "@/lib/actions/preferences";
import type { ItemStatus, LibraryItem, LibrarySort } from "@/lib/queries/items";
// resolveSortDirection/LibrarySortDirection come from this leaf module
// directly (not from "@/lib/queries/items", which the line above only
// type-imports from) -- items.ts's top-level `createClient` import
// (@/lib/supabase/server) depends on next/headers, which is
// Server-Component-only; a *value* import of resolveSortDirection through
// items.ts would pull that whole module graph into this client component's
// bundle and fail the build. See sortDirection.ts's own comment.
import { resolveSortDirection, type LibrarySortDirection } from "@/lib/queries/sortDirection";
import type { SubtypeOption } from "@/lib/queries/subtypes";
import type { TagOption } from "@/lib/queries/tags";

import { ItemCard } from "./ItemCard";
import { ItemListRow } from "./ItemListRow";

export type ViewMode = "list" | "card";

// Debounce delay for the search box and filter controls below (issues #22,
// #23) -- long enough that a normal typing/clicking cadence doesn't fire a
// server round trip per keystroke/click, short enough to still read as
// "reasonably responsive" per #22's acceptance criteria (#23 follows the
// same convention per its own Constraints).
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
];

const RATING_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

// Five dimensions (issue #24's original three, plus Rating/Title added by
// #39) -- labels are Title Case for the UI, distinct from the plain
// lowercase-with-underscore values LibrarySort/user_preferences.default_sort
// itself is constrained to (see lib/queries/items.ts).
const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "recently_added", label: "Recently Added" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "rating", label: "Rating" },
  { value: "title", label: "Title (A-Z)" },
];

// Direction toggle labels (issue #39's acceptance criteria): each names the
// dimension's own two concrete states rather than a generic
// "Ascending"/"Descending", which is meaningless for Priority/Status (no
// inherent greater/lesser scale -- their "direction" just reverses the
// fixed bucket order end-to-end). Keyed by the *effective* direction (after
// resolveSortDirection has already turned a `null` "use the default" into
// a concrete 'asc'/'desc') -- the button below always shows the label for
// whichever state is currently active, and clicking it switches to the
// other one.
const SORT_DIRECTION_LABELS: Record<LibrarySort, Record<LibrarySortDirection, string>> = {
  recently_added: { desc: "Newest first", asc: "Oldest first" },
  priority: { desc: "High → Low", asc: "Low → High" },
  status: { desc: "Ongoing → Dropped", asc: "Dropped → Ongoing" },
  rating: { desc: "Highest first", asc: "Lowest first" },
  title: { asc: "A → Z", desc: "Z → A" },
};

// Category library view (issue #12): the List/Card toggle is always
// visible above the content area (including on zero items), defaults to
// the signed-in user's persisted `user_preferences.list_view_mode` (List
// when null), and each toggle click is applied optimistically to local
// state, then fire-and-forget persisted via updateListViewMode -- same
// "optimistic local change, swallow persistence errors" pattern as
// ThemeToggle.tsx (#8).
//
// Search box (issue #22) + filter controls (issue #23): `items` is this
// category's full unfiltered list as loaded by the server component
// (page.tsx). `queryResults` holds the most recent debounced
// filterLibraryItemsAction() response for whatever combination of search
// term/filters is currently active -- `null` while nothing has resolved yet
// (nothing active, or still inside the debounce window). `displayedItems`
// below is the one derived value actually rendered: `items` whenever the
// search box is blank AND every filter is at its default (no extra round
// trip -- satisfies "empty search/filters returns the same unfiltered list"
// instantly, with no network race), `queryResults` once available.
// Deliberately not synced back to `items` via a setState call in the effect
// below on clearing -- react-hooks/set-state-in-effect flags a synchronous
// setState in an effect body, and it's unnecessary here anyway: rendering
// `items` directly whenever nothing is active is simpler than clearing
// state to reach the same value.
//
// Search term and all four filters are read by ONE effect below and sent
// to ONE combined action (filterLibraryItemsAction) -- per #23's own
// "changing any filter re-applies on top of whatever the search box
// currently holds (and vice versa) -- the two controls read from the same
// combined query, not two independent, later-merged lists" requirement.
// The actual AND-across-dimensions / OR-within-tags combine logic all
// happens in the database -- see lib/queries/items.ts's getLibraryItems and
// database-schema.md §5.
//
// Sort control (issue #24, direction toggle + Rating/Title added by #39):
// `sort`/`direction` join that same effect/action rather than getting their
// own -- both are orthogonal to search/filters (an ORDER BY applied on top
// of whatever WHERE they produce), but still have to ride the same server
// round trip, since LibraryItem has no created_at/rating/title fields
// LibraryView itself could re-sort by client-side. `items` (the
// server-fetched prop) is already sorted per `initialSort`/
// `initialDirection` (page.tsx passes both to getLibraryItems too), so
// `displayedItems` can keep rendering `items` directly -- no extra query --
// for as long as `sort`/`direction` stay at their initial values and no
// search/filter is active; either changing away from its initial value
// folds into `hasActiveQuery` below so it triggers the same debounced round
// trip filters/search already use. Selecting a sort option or toggling
// direction is applied optimistically to local state immediately, then
// persisted fire-and-forget via updateDefaultSort -- same pattern as the
// List/Card toggle's updateListViewMode.
//
// `direction` holds the *raw* persisted/local value (asc/desc/null, `null`
// meaning "use this dimension's own default") -- resolveSortDirection
// (lib/queries/items.ts) turns that into the concrete 'asc'/'desc'
// (`effectiveDirection` below) actually used for the direction toggle's
// label and passed to the server. Switching `sort` (handleSortChange)
// always resets `direction` back to `null` -- never carries over whatever
// raw asc/desc the previously-selected dimension happened to have (issue
// #39's acceptance criteria) -- so the newly-selected dimension opens on
// its own natural default rather than an unrelated one's.
export function LibraryView({
  categoryId,
  categoryName,
  categorySlug,
  items,
  initialViewMode,
  initialSort,
  initialDirection,
  subtypes,
  tags,
}: {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  items: LibraryItem[];
  initialViewMode: ViewMode;
  initialSort: LibrarySort;
  initialDirection: LibrarySortDirection | null;
  subtypes: SubtypeOption[];
  tags: TagOption[];
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState<LibrarySort>(initialSort);
  const [direction, setDirection] = useState<LibrarySortDirection | null>(initialDirection);
  const effectiveDirection = resolveSortDirection(sort, direction);

  // Filter controls (issue #23) -- "" means the dimension's default ("All
  // subtypes"/"All statuses"/"Any rating"); an empty selectedTagIds array
  // means no tag filtering. All page-local component state, per the issue's
  // own "not persisted anywhere" constraint -- nothing here is written to
  // user_preferences or a URL param, so a reload resets every one of them,
  // same as the search box already does.
  const [subtypeId, setSubtypeId] = useState("");
  const [status, setStatus] = useState<"" | ItemStatus>("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [ratingMin, setRatingMin] = useState<"" | number>("");

  const [queryResults, setQueryResults] = useState<LibraryItem[] | null>(null);
  // Guards against an in-flight response from an earlier keystroke/click
  // overwriting a later, faster-returning one.
  const queryRequestId = useRef(0);

  const categorySubtypes = subtypes.filter((subtype) => subtype.categoryId === categoryId);

  const trimmedSearchTerm = searchTerm.trim();
  const hasActiveFilters =
    subtypeId !== "" || status !== "" || selectedTagIds.length > 0 || ratingMin !== "";
  // `items` only matches the currently-selected sort+direction while both
  // are still at their initial (server-fetched) values -- once the user
  // picks a different dimension or toggles direction, rendering `items`
  // as-is would show the wrong order, so that also has to route through the
  // same round trip as an active search/filter. Compared as the raw
  // persisted/local values (not `effectiveDirection`) -- consistent with
  // `sort` itself, which is also compared raw rather than "does this
  // resolve to the same order".
  const hasActiveQuery =
    trimmedSearchTerm !== "" ||
    hasActiveFilters ||
    sort !== initialSort ||
    direction !== initialDirection;
  const displayedItems = hasActiveQuery ? (queryResults ?? items) : items;

  // Stable string key for the effect's dependency array -- selectedTagIds'
  // array identity changes on every toggle even when its contents would
  // dedupe to the same set, and order doesn't matter for an OR-match, so a
  // sorted, joined key is what actually determines whether a new query is
  // needed.
  const tagIdsKey = [...selectedTagIds].sort().join(",");

  useEffect(() => {
    if (!hasActiveQuery) return;

    const thisRequestId = ++queryRequestId.current;
    const timeoutId = setTimeout(() => {
      filterLibraryItemsAction(
        categoryId,
        trimmedSearchTerm,
        {
          subtypeId: subtypeId || undefined,
          status: status || undefined,
          tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          minRating: ratingMin === "" ? undefined : ratingMin,
        },
        sort,
        direction,
      )
        .then((results) => {
          if (queryRequestId.current === thisRequestId) {
            setQueryResults(results);
          }
        })
        .catch(() => {
          // Swallowed, same fire-and-forget-error convention as
          // updateListViewMode below -- a transient search/filter failure
          // leaves whatever results were already showing rather than
          // clearing them or throwing.
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // tagIdsKey (not selectedTagIds) intentionally drives re-running this
    // effect -- see its own comment above. selectedTagIds itself is read
    // from the closure, which is fine: this effect is recreated every
    // render regardless (categoryId/trimmedSearchTerm/etc. are all
    // primitives), so the closure always sees the current array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryId,
    trimmedSearchTerm,
    subtypeId,
    status,
    tagIdsKey,
    ratingMin,
    sort,
    direction,
    hasActiveQuery,
  ]);

  function handleSelect(mode: ViewMode) {
    if (mode === viewMode) return;

    setViewMode(mode);
    updateListViewMode(mode).catch(() => {
      // Intentionally swallowed -- see the comment above.
    });
  }

  // Direction toggle (issue #39) -- flips the *effective* (already-resolved)
  // direction to its other state and persists that as an explicit
  // 'asc'/'desc' (never null -- the user just made an explicit choice, so
  // there's no more "use the dimension's default" left to represent).
  // `sort` rides along unchanged in the same updateDefaultSort call, per
  // that action's own "fold direction into the same call" shape.
  function handleDirectionToggle() {
    const nextDirection: LibrarySortDirection = effectiveDirection === "asc" ? "desc" : "asc";

    setDirection(nextDirection);
    updateDefaultSort(sort, nextDirection).catch(() => {
      // Intentionally swallowed -- see handleSelect's comment above.
    });
  }

  function handleSortChange(nextSort: LibrarySort) {
    if (nextSort === sort) return;

    setSort(nextSort);
    // Direction always resets to null (the new dimension's own default) on
    // a dimension switch -- see this component's own comment above
    // handleDirectionToggle/the props block for why.
    setDirection(null);
    updateDefaultSort(nextSort, null).catch(() => {
      // Intentionally swallowed -- see handleSelect's comment above.
    });
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  }

  function handleClearFilters() {
    setSubtypeId("");
    setStatus("");
    setSelectedTagIds([]);
    setRatingMin("");
  }

  // Deliberately keyed off search/filters alone, not hasActiveQuery -- a
  // sort-only round trip (no search term, no filter active) against a truly
  // empty category must still read "No items in {category} yet.", not "No
  // items match the selected filters." (sort has no filtering effect of its
  // own to describe).
  const hasActiveSearchOrFilters = trimmedSearchTerm !== "" || hasActiveFilters;
  const emptyMessage = !hasActiveSearchOrFilters
    ? `No items in ${categoryName} yet.`
    : trimmedSearchTerm !== ""
      ? `No items match "${trimmedSearchTerm}".`
      : "No items match the selected filters.";

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-text-primary">
          {categoryName}
        </h1>
        <div className="flex items-center gap-3">
          {/* Entry point for the Full Add form (issue #14) -- links to the
              category-agnostic /add route rather than pre-filling this
              category, since the form's own Category dropdown is what
              drives its reactive Subtype filtering. */}
          <Button asChild size="sm">
            <Link href="/add">Add item</Link>
          </Button>
          {/* Entry point for the Quick Add flow (issue #15) -- unlike Full
              Add above, this route's Category field has no reactive
              subtype list to drive, so pre-filling it via ?category=<slug>
              is exactly the "two interactions: title, submit" the issue
              calls for when arriving from this category's own view. */}
          <Button asChild size="sm" variant="outline">
            <Link href={`/quick-add?category=${categorySlug}`}>Quick Add</Link>
          </Button>
          <div
            role="group"
            aria-label="View mode"
            className="flex gap-1 rounded-md border border-border bg-surface p-1"
          >
            <Button
              type="button"
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              aria-pressed={viewMode === "list"}
              onClick={() => handleSelect("list")}
            >
              List
            </Button>
            <Button
              type="button"
              variant={viewMode === "card" ? "default" : "outline"}
              size="sm"
              aria-pressed={viewMode === "card"}
              onClick={() => handleSelect("card")}
            >
              Card
            </Button>
          </div>
        </div>
      </div>

      {/* Search box (issue #22): partial-word match across title/tags/
          notes/review, scoped to this category -- see the effect above for
          the debounce + DB-side matching. Always visible (even with zero
          items), same "always shown" convention as the List/Card toggle. */}
      <Input
        type="search"
        aria-label="Search"
        placeholder="Search title, tags, notes, review"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        className="max-w-sm"
      />

      {/* Filter controls (issue #23): Subtype/Status/Tags/Rating, all
          combining with AND against each other and against the search box
          above (single-select for Subtype/Status, OR-match multi-select for
          Tags, minimum-threshold for Rating) -- see the effect above for the
          combined-query mechanics. Always visible, same convention as the
          search box. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Subtype"
          value={subtypeId}
          onChange={(event) => setSubtypeId(event.target.value)}
          className="w-auto min-w-40"
        >
          <option value="">All subtypes</option>
          {categorySubtypes.map((subtype) => (
            <option key={subtype.id} value={subtype.id}>
              {subtype.name}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as "" | ItemStatus)}
          className="w-auto min-w-40"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {/* Native <details>/<summary> disclosure rather than a new popover
            dependency -- reuses the existing Checkbox primitive for the
            multi-select list inside, same shape as the Full Add form's own
            tag checkbox group (app/(app)/add/AddItemForm.tsx). */}
        <details className="relative">
          {/* Mobile-first h-11 (44px touch-target baseline, issue #31),
              md:h-9 restores the original desktop density -- same pattern
              as the Button/Input/Select primitives. */}
          <summary className="flex h-11 w-40 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text-primary shadow-xs md:h-9 [&::-webkit-details-marker]:hidden">
            Tags{selectedTagIds.length > 0 ? ` (${selectedTagIds.length})` : ""}
          </summary>
          <div className="absolute z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-md">
            {tags.length === 0 ? (
              <p className="text-sm text-text-secondary">No tags available yet.</p>
            ) : (
              tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-2 py-3 text-sm text-text-primary md:py-1"
                >
                  <Checkbox
                    checked={selectedTagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                  />
                  {tag.name}
                </label>
              ))
            )}
          </div>
        </details>

        <Select
          aria-label="Rating"
          value={ratingMin}
          onChange={(event) =>
            setRatingMin(event.target.value === "" ? "" : Number(event.target.value))
          }
          className="w-auto min-w-32"
        >
          <option value="">Any rating</option>
          {RATING_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}+ rating
            </option>
          ))}
        </Select>

        <Button type="button" size="sm" variant="outline" onClick={handleClearFilters}>
          Clear filters
        </Button>

        {/* Sort control (issue #24, direction toggle added by #39) --
            independent of the four filter controls above (not reset by
            Clear filters, doesn't reset them): an ORDER BY composed on top
            of whatever WHERE search/filters already produced, per this
            issue's own constraint. Always visible, same convention as the
            rest of this row. */}
        <Select
          aria-label="Sort"
          value={sort}
          onChange={(event) => handleSortChange(event.target.value as LibrarySort)}
          className="ml-auto w-auto min-w-40"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {/* Direction toggle (issue #39) -- applies only to the
            currently-selected sort dimension above. Labeled with that
            dimension's own two concrete states (e.g. "High → Low"), not a
            generic "Ascending/Descending" -- see SORT_DIRECTION_LABELS'
            own comment for why. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Sort direction"
          onClick={handleDirectionToggle}
        >
          {SORT_DIRECTION_LABELS[sort][effectiveDirection]}
        </Button>
      </div>

      {displayedItems.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          {emptyMessage}
        </p>
      ) : viewMode === "list" ? (
        <div className="flex flex-col rounded-lg border border-border bg-surface">
          {displayedItems.map((item) => (
            <ItemListRow key={item.id} categorySlug={categorySlug} item={item} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {displayedItems.map((item) => (
            <ItemCard key={item.id} categorySlug={categorySlug} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
