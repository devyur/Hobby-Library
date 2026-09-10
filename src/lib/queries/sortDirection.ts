// Sort dimension/direction types + the resolveSortDirection helper (issue
// #39) -- pulled out of items.ts into their own dependency-free module so
// LibraryView.tsx (a client component) can import resolveSortDirection
// directly without pulling items.ts's module graph (which imports
// createClient from @/lib/supabase/server, a next/headers-dependent,
// Server-Component-only module) into the client bundle. Next.js's build
// fails hard the moment *any* client-reachable module statically imports
// next/headers, even if the specific binding a client component uses never
// touches it -- a plain `import type { LibrarySort } from "./items"` is
// fine (fully erased at compile time, no runtime import survives), but a
// *value* import like `resolveSortDirection` is not, since it keeps
// items.ts's own top-level imports in the client's module graph.
// items.ts re-exports everything from here (see its own top of file), so
// every other caller (getLibraryItems' own ORDER BY logic, page.tsx,
// lib/actions/items.ts, items.test.ts) keeps importing these from
// "@/lib/queries/items" as before -- LibraryView.tsx is the one exception
// that has to import resolveSortDirection from here directly.

// Sort dimensions added by issue #24 (recently_added/priority/status) and
// extended by issue #39 (rating/title). Matches the plain
// lowercase-with-underscore values `user_preferences.default_sort` itself
// is constrained to (migration 20260909160000, extended by 20260910160000),
// not the Title Case UI labels (see LibraryView.tsx's SORT_OPTIONS).
export type LibrarySort = "recently_added" | "priority" | "status" | "rating" | "title";

// Direction toggle added by issue #39 -- a single raw 'asc'/'desc' flag
// (matching `user_preferences.default_sort_direction`'s own check
// constraint, migration 20260910160000) applied to whichever `sort`
// dimension is currently selected, rather than a per-dimension value. What
// 'asc'/'desc' *means* is dimension-specific: recently_added/rating/title
// have a real ascending/descending scale, but priority/status don't --
// their "direction" is defined as reversing the fixed bucket order
// end-to-end (see the ORDER BY branches in getLibraryItems, items.ts). A
// `null` (or omitted) direction means "use the selected dimension's own
// natural default direction" -- resolveSortDirection below is the one
// place that default is defined, per dimension.
export type LibrarySortDirection = "asc" | "desc";

// Each dimension's own "default" state (issue #39's acceptance criteria):
// Recently Added/Priority/Status/Rating default to their existing #24
// behavior (unchanged by this issue) -- Newest first / High->Low /
// Ongoing->Dropped / Highest first, all of which this table labels 'desc'.
// Title is new in this issue with no prior behavior to preserve, and reads
// most naturally starting at A->Z, i.e. 'asc'.
export const DEFAULT_SORT_DIRECTION: Record<LibrarySort, LibrarySortDirection> = {
  recently_added: "desc",
  priority: "desc",
  status: "desc",
  rating: "desc",
  title: "asc",
};

// The one place a `null`/undefined `default_sort_direction` (or a freshly
// switched-to dimension that hasn't been given an explicit direction yet)
// resolves to a concrete 'asc'/'desc' -- shared by getLibraryItems
// (items.ts) and by LibraryView.tsx/page.tsx so every caller resolves "use
// the default" the same way. Switching dimensions must reset to *this*
// function's result for the new dimension, never carry over the previous
// dimension's raw asc/desc (issue #39's acceptance criteria) -- callers
// achieve that by passing `null` (not the old direction) alongside a new
// `sort`.
export function resolveSortDirection(
  sort: LibrarySort,
  direction: LibrarySortDirection | null | undefined,
): LibrarySortDirection {
  return direction ?? DEFAULT_SORT_DIRECTION[sort];
}
