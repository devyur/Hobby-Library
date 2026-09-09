"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { filterLibraryItemsAction } from "@/lib/actions/items";
import { updateListViewMode } from "@/lib/actions/preferences";
import type { ItemStatus, LibraryItem } from "@/lib/queries/items";
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
export function LibraryView({
  categoryId,
  categoryName,
  categorySlug,
  items,
  initialViewMode,
  subtypes,
  tags,
}: {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  items: LibraryItem[];
  initialViewMode: ViewMode;
  subtypes: SubtypeOption[];
  tags: TagOption[];
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [searchTerm, setSearchTerm] = useState("");

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
  const hasActiveQuery = trimmedSearchTerm !== "" || hasActiveFilters;
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
      filterLibraryItemsAction(categoryId, trimmedSearchTerm, {
        subtypeId: subtypeId || undefined,
        status: status || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        minRating: ratingMin === "" ? undefined : ratingMin,
      })
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
  }, [categoryId, trimmedSearchTerm, subtypeId, status, tagIdsKey, ratingMin, hasActiveQuery]);

  function handleSelect(mode: ViewMode) {
    if (mode === viewMode) return;

    setViewMode(mode);
    updateListViewMode(mode).catch(() => {
      // Intentionally swallowed -- see the comment above.
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

  const emptyMessage = !hasActiveQuery
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
          <summary className="flex h-9 w-40 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text-primary shadow-xs [&::-webkit-details-marker]:hidden">
            Tags{selectedTagIds.length > 0 ? ` (${selectedTagIds.length})` : ""}
          </summary>
          <div className="absolute z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-md">
            {tags.length === 0 ? (
              <p className="text-sm text-text-secondary">No tags available yet.</p>
            ) : (
              tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-2 py-1 text-sm text-text-primary"
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
