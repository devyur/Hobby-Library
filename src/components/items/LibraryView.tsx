"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { updateListViewMode } from "@/lib/actions/preferences";
import type { LibraryItem } from "@/lib/queries/items";

import { ItemCard } from "./ItemCard";
import { ItemListRow } from "./ItemListRow";

export type ViewMode = "list" | "card";

// Category library view (issue #12): the List/Card toggle is always
// visible above the content area (including on zero items), defaults to
// the signed-in user's persisted `user_preferences.list_view_mode` (List
// when null), and each toggle click is applied optimistically to local
// state, then fire-and-forget persisted via updateListViewMode -- same
// "optimistic local change, swallow persistence errors" pattern as
// ThemeToggle.tsx (#8).
export function LibraryView({
  categoryName,
  categorySlug,
  items,
  initialViewMode,
}: {
  categoryName: string;
  categorySlug: string;
  items: LibraryItem[];
  initialViewMode: ViewMode;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);

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

      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          No items in {categoryName} yet.
        </p>
      ) : viewMode === "list" ? (
        <div className="flex flex-col rounded-lg border border-border bg-surface">
          {items.map((item) => (
            <ItemListRow key={item.id} categorySlug={categorySlug} item={item} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <ItemCard key={item.id} categorySlug={categorySlug} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
