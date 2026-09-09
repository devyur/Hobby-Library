"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchLibraryItemsAction } from "@/lib/actions/items";
import { updateListViewMode } from "@/lib/actions/preferences";
import type { LibraryItem } from "@/lib/queries/items";

import { ItemCard } from "./ItemCard";
import { ItemListRow } from "./ItemListRow";

export type ViewMode = "list" | "card";

// Debounce delay for the search box below (issue #22) -- long enough that a
// normal typing cadence doesn't fire a server round trip per keystroke,
// short enough to still read as "reasonably responsive" per the issue's
// acceptance criteria.
const SEARCH_DEBOUNCE_MS = 300;

// Category library view (issue #12): the List/Card toggle is always
// visible above the content area (including on zero items), defaults to
// the signed-in user's persisted `user_preferences.list_view_mode` (List
// when null), and each toggle click is applied optimistically to local
// state, then fire-and-forget persisted via updateListViewMode -- same
// "optimistic local change, swallow persistence errors" pattern as
// ThemeToggle.tsx (#8).
//
// Search box (issue #22): `items` is this category's full unfiltered list
// as loaded by the server component (page.tsx). `searchResults` holds the
// most recent debounced searchLibraryItemsAction() response for the current
// non-blank term -- `null` while no non-blank term has resolved yet (never
// searched, or still inside the debounce window). `displayedItems` below is
// the one derived value actually rendered: `items` whenever the box is
// blank (no extra round trip -- satisfies "empty search returns the same
// unfiltered list" instantly, with no network race), `searchResults` once
// available. Deliberately not synced back to `items` via a setState call in
// the effect below on clearing -- react-hooks/set-state-in-effect flags a
// synchronous setState in an effect body, and it's unnecessary here anyway:
// rendering `items` directly whenever the term is blank is simpler than
// clearing state to reach the same value. The matching itself (title/notes/
// review/tag name, partial-word, OR'd, scoped to categoryId) happens
// entirely in the database via getLibraryItems' search_item_ids() RPC --
// see lib/queries/items.ts and database-schema.md §5.
export function LibraryView({
  categoryId,
  categoryName,
  categorySlug,
  items,
  initialViewMode,
}: {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  items: LibraryItem[];
  initialViewMode: ViewMode;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<LibraryItem[] | null>(null);
  // Guards against an in-flight search response from an earlier keystroke
  // overwriting a later, faster-returning one.
  const searchRequestId = useRef(0);

  const trimmedSearchTerm = searchTerm.trim();
  const displayedItems = trimmedSearchTerm === "" ? items : (searchResults ?? items);

  useEffect(() => {
    if (trimmedSearchTerm === "") return;

    const thisRequestId = ++searchRequestId.current;
    const timeoutId = setTimeout(() => {
      searchLibraryItemsAction(categoryId, trimmedSearchTerm)
        .then((results) => {
          if (searchRequestId.current === thisRequestId) {
            setSearchResults(results);
          }
        })
        .catch(() => {
          // Swallowed, same fire-and-forget-error convention as
          // updateListViewMode below -- a transient search failure leaves
          // whatever results were already showing rather than clearing them
          // or throwing.
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [trimmedSearchTerm, categoryId]);

  function handleSelect(mode: ViewMode) {
    if (mode === viewMode) return;

    setViewMode(mode);
    updateListViewMode(mode).catch(() => {
      // Intentionally swallowed -- see the comment above.
    });
  }

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

      {displayedItems.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          {trimmedSearchTerm === ""
            ? `No items in ${categoryName} yet.`
            : `No items match "${trimmedSearchTerm}".`}
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
