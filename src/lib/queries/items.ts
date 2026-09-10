import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import {
  DEFAULT_SORT_DIRECTION,
  resolveSortDirection,
  type LibrarySort,
  type LibrarySortDirection,
} from "./sortDirection";

// Re-exported so every existing caller (page.tsx, lib/actions/items.ts,
// items.test.ts) keeps importing these from "@/lib/queries/items" as
// before -- LibrarySort/LibrarySortDirection/DEFAULT_SORT_DIRECTION/
// resolveSortDirection actually live in ./sortDirection.ts now, a
// dependency-free module split out by issue #39 specifically so
// LibraryView.tsx (a client component) can import resolveSortDirection
// directly from there without pulling this file's own `createClient`
// (next/headers-dependent, Server-Component-only) import into the client
// bundle -- see sortDirection.ts's own comment for the full reasoning.
export type { LibrarySort, LibrarySortDirection };
export { DEFAULT_SORT_DIRECTION, resolveSortDirection };

// Reusable read query (issue #12), added alongside categories.ts rather than
// overloading it per the issue's own file constraints. Fetches every
// non-deleted item the signed-in user owns in one category, ordered per the
// `sort` param (issue #24; created_at desc, unchanged, when omitted). RLS on
// `items` already scopes reads to `auth.uid()` (database-schema.md §4), so
// no explicit user_id filter is needed here.

export type ItemStatus = Database["public"]["Enums"]["item_status"];
type PriorityLevel = Database["public"]["Enums"]["priority_level"];

export interface LibraryItem {
  id: string;
  title: string;
  status: ItemStatus;
  rating: number | null;
  priority: PriorityLevel | null;
  subtypeName: string;
  tags: string[];
  coverUrl: string | null;
}

// Shared by getLibraryItems and getItemDetail below (issue #38). The
// `covers` bucket is public (migration 20260910150000), so getPublicUrl()
// returns a stable, un-signed URL with no network round trip -- unlike
// createSignedUrl(), this is synchronous. The `?v=` param is sourced from
// item_images.updated_at (added by the same migration, maintained by the
// item_images_set_updated_at trigger, and advanced on every replace by
// uploadCoverAction's now-real UPDATE branch -- lib/actions/covers.ts) so a
// long client-side cache lifetime for this URL never serves stale bytes
// after a cover is replaced: the path stays fixed, but the query string
// changes, which is enough for the browser to treat it as a new resource.
function resolvePublicCoverUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  coverImage: { storage_path: string; updated_at: string },
): string | null {
  const { data } = supabase.storage.from("covers").getPublicUrl(coverImage.storage_path);
  if (!data?.publicUrl) return null;
  const version = new Date(coverImage.updated_at).getTime();
  return `${data.publicUrl}?v=${version}`;
}

// The `attachments` bucket is private/path-scoped (database-schema.md §7),
// so its download URLs still need a per-request signed URL -- 1 hour
// comfortably outlives a single page render/request. The `covers` bucket
// is public since issue #38: cover URLs are resolved via getPublicUrl()
// below instead, with a `?v=` cache-busting param sourced from
// item_images.updated_at so a long browser cache lifetime never serves
// stale bytes after a replace (see getLibraryItems'/getItemDetail's cover
// resolution below).
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;

// Filter dimensions added by issue #23, all optional and all AND'd together
// (and AND'd with searchTerm when both are present) -- subtype/status are
// single-select (one id/value each), tagIds is a set that OR-matches (any
// selected tag, not all), minRating is a `rating >= minRating` threshold
// where a NULL rating never matches once set. See getLibraryItems' own
// comment below for how each is actually applied.
export interface LibraryItemFilters {
  subtypeId?: string;
  status?: ItemStatus;
  tagIds?: string[];
  minRating?: number;
}

// searchTerm is optional (issue #22): omitted/blank returns the same
// unfiltered, created_at-desc list as before #22 ever existed. When
// non-blank, matching itself happens in the database via the
// search_item_ids() RPC (supabase/migrations/
// 20260909150000_add_search_trigram_indexes.sql) -- title/notes/review
// ILIKE'd directly, tag names matched through an EXISTS join to item_tags/
// tags (database-schema.md §5; tags is a separate table, not a column this
// function's own select touches). That RPC returns only matching ids, kept
// in a second query below reusing the exact same select shape as the
// unfiltered path, rather than a parallel query function -- per the issue's
// own constraint.
//
// filters is optional too (issue #23), extending this same function rather
// than forking a parallel one (per that issue's own constraint). subtype_id/
// status/rating are plain `.eq`/`.gte` conditions against `items` below --
// `.gte("rating", n)` naturally excludes `rating IS NULL` rows since
// Postgres evaluates `NULL >= n` as NULL (not true), matching the "NULL
// ratings never match once a threshold is set" acceptance criterion with no
// extra code. tagIds is resolved via a separate `item_tags` query (an
// id IN (...) narrowing, same shape as the search RPC's own id list) since
// it OR-matches across possibly-several tag ids -- not expressible as a
// single `.eq`. When both a search term and tagIds are active, the two id
// lists are intersected before being applied, so the final result still
// satisfies (search term) AND (any selected tag), never just one or the
// other.
//
// sort is optional too (issue #24, extended by #39), applied as the final
// ORDER BY on whatever result set the searchTerm/filters logic above
// already narrowed to -- see the `.order(...)` calls near the bottom of
// this function. Priority/Status/Title are expressed as a Postgres-side
// rank/key via computed-field functions (`item_priority_rank`/
// `item_priority_rank_reverse`/`item_status_rank`/`item_title_sort_key`,
// migrations 20260909160000/20260910160000), not fetched unsorted and
// reordered in JS, per #24's own constraint (reaffirmed by #39 for the two
// new dimensions). `direction` (issue #39) is resolved to a concrete
// 'asc'/'desc' via resolveSortDirection before any ORDER BY is built, then
// applied per-dimension -- see the branches below for what 'asc'/'desc'
// means for each one.
export async function getLibraryItems(
  categoryId: string,
  searchTerm?: string,
  filters?: LibraryItemFilters,
  sort?: LibrarySort,
  direction?: LibrarySortDirection | null,
): Promise<LibraryItem[]> {
  const supabase = await createClient();

  const trimmedSearchTerm = searchTerm?.trim() ?? "";

  let searchMatchingIds: string[] | null = null;
  if (trimmedSearchTerm !== "") {
    const { data: matches, error: searchError } = await supabase.rpc("search_item_ids", {
      p_category_id: categoryId,
      p_search_term: trimmedSearchTerm,
    });

    if (searchError) {
      console.error("Failed to search items:", searchError.message);
      return [];
    }

    searchMatchingIds = (matches ?? []).map((row) => row.id);
    // Zero matches -- skip every other query entirely rather than pass an
    // empty .in() list (which itself correctly returns zero rows, but
    // there's no point round-tripping for it).
    if (searchMatchingIds.length === 0) return [];
  }

  let tagMatchingIds: string[] | null = null;
  if (filters?.tagIds && filters.tagIds.length > 0) {
    // item_tags' own RLS (item_tags_select_own, migration
    // 20260908140000_create_item_relations_tables.sql) already scopes this
    // to items the signed-in user owns via an EXISTS check, so no explicit
    // user_id filter is needed here -- same reasoning the rest of this file
    // already relies on for `items`/`subtypes`/`tags`.
    const { data: tagMatches, error: tagError } = await supabase
      .from("item_tags")
      .select("item_id")
      .in("tag_id", filters.tagIds);

    if (tagError) {
      console.error("Failed to filter items by tag:", tagError.message);
      return [];
    }

    tagMatchingIds = Array.from(new Set((tagMatches ?? []).map((row) => row.item_id)));
    if (tagMatchingIds.length === 0) return [];
  }

  // AND the two id lists together (search term AND tag match) when both are
  // active, rather than letting a later `.in()` call silently overwrite the
  // other -- Supabase's query builder only keeps the last `.in()` on a given
  // column if called twice.
  let matchingIds: string[] | null = null;
  if (searchMatchingIds && tagMatchingIds) {
    const tagIdSet = new Set(tagMatchingIds);
    matchingIds = searchMatchingIds.filter((id) => tagIdSet.has(id));
    if (matchingIds.length === 0) return [];
  } else {
    matchingIds = searchMatchingIds ?? tagMatchingIds;
  }

  let query = supabase
    .from("items")
    .select(
      `
      id,
      title,
      status,
      rating,
      priority,
      subtypes ( name ),
      item_tags ( tags ( name ) ),
      item_images ( storage_path, is_cover, updated_at )
    `,
    )
    .eq("category_id", categoryId)
    .is("deleted_at", null);

  // Priority/Status/Rating/Title each order by their sort key first, then
  // created_at desc as the fixed tie-breaker within a bucket/equal value --
  // that tie-break is never itself reversed by `direction` (issue #39's
  // acceptance criteria). Recently Added (the default, including when
  // `sort` is omitted/undefined -- a null user_preferences.default_sort) has
  // no separate tie-break since created_at desc/asc *is* its own ordering.
  //
  // Priority: no ascending/descending scale of its own (issue #39) -- its
  // "direction" reverses the fixed High->Low bucket order end-to-end.
  // Rather than negate a single rank column (which would also move "no
  // priority set" out of last place), the resolved direction picks between
  // two separate computed-field rank functions that each independently pin
  // "no priority set" to last (rank 4): item_priority_rank (High->Low, the
  // 'desc'/default direction) and item_priority_rank_reverse (Low->High,
  // 'asc').
  //
  // Status: same "no inherent scale, direction reverses the bucket order"
  // reasoning, but with no "unset" bucket to protect (status is never
  // null) -- so this one *can* just flip the existing item_status_rank
  // column's own ascending flag. 'desc' (default, Ongoing->Dropped) reuses
  // the same `ascending: true` #24 always used; 'asc' (Dropped->Ongoing)
  // flips it to `ascending: false`, which puts the highest rank
  // (dropped=4) first -- the fixed bucket order fully reversed.
  //
  // Rating: a real numeric scale, ordered directly on the `rating` column.
  // `nullsFirst: false` is set for *both* directions (not just the default)
  // so a rating-less item sorts last whether "Highest first" or "Lowest
  // first" is selected -- same NULL-last precedent as #23's rating filter
  // and #24's Priority sort.
  //
  // Title: case-insensitive (issue #39's acceptance criteria), via the
  // item_title_sort_key computed field (lower(title)) rather than the raw
  // `title` column, whose collation isn't guaranteed to interleave by
  // letter regardless of case.
  const effectiveSort: LibrarySort = sort ?? "recently_added";
  const effectiveDirection = resolveSortDirection(effectiveSort, direction);

  if (effectiveSort === "priority") {
    const rankColumn =
      effectiveDirection === "asc" ? "item_priority_rank_reverse" : "item_priority_rank";
    query = query.order(rankColumn, { ascending: true }).order("created_at", { ascending: false });
  } else if (effectiveSort === "status") {
    query = query
      .order("item_status_rank", { ascending: effectiveDirection === "desc" })
      .order("created_at", { ascending: false });
  } else if (effectiveSort === "rating") {
    query = query
      .order("rating", { ascending: effectiveDirection === "asc", nullsFirst: false })
      .order("created_at", { ascending: false });
  } else if (effectiveSort === "title") {
    query = query
      .order("item_title_sort_key", { ascending: effectiveDirection === "asc" })
      .order("created_at", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: effectiveDirection === "asc" });
  }

  if (matchingIds) {
    query = query.in("id", matchingIds);
  }
  if (filters?.subtypeId) {
    query = query.eq("subtype_id", filters.subtypeId);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.minRating !== undefined) {
    query = query.gte("rating", filters.minRating);
  }

  const { data, error } = await query;

  if (error) {
    // Swallowed rather than thrown, same convention as getCategories: a
    // library page that renders empty because of a transient read error is
    // better than one that crashes outright.
    console.error("Failed to load items:", error.message);
    return [];
  }

  return Promise.all(
    (data ?? []).map(async (row) => {
      // Nested embedded-resource shape depends on FK cardinality
      // (belongs-to -> object, has-many -> array); normalized defensively
      // here since this project's types.ts is generated by a fallback tool
      // (see its header comment), not the literal `supabase gen types` CLI.
      const subtype = Array.isArray(row.subtypes) ? row.subtypes[0] : row.subtypes;
      const images = Array.isArray(row.item_images) ? row.item_images : [];
      const coverImage = images.find((image) => image.is_cover);

      const coverUrl = coverImage ? resolvePublicCoverUrl(supabase, coverImage) : null;

      const tagRows = Array.isArray(row.item_tags) ? row.item_tags : [];
      const tags = tagRows
        .map((itemTag) => {
          const tag = Array.isArray(itemTag.tags) ? itemTag.tags[0] : itemTag.tags;
          return tag?.name ?? null;
        })
        .filter((name): name is string => name !== null);

      return {
        id: row.id,
        title: row.title,
        status: row.status,
        rating: row.rating,
        priority: row.priority,
        subtypeName: subtype?.name ?? "",
        tags,
        coverUrl,
      };
    }),
  );
}

// Item detail page (issue #13). Every field from plan.md §3 plus the two
// structural relations (Links, Attachments) the detail page also renders.
//
// ItemTag carries `id` alongside `name` (unlike LibraryItem's bare
// `tags: string[]` above) -- issue #17's detach control needs a tag_id to
// act on, which a plain name string can't provide. getLibraryItems/
// TagChips's read-only Card/List views have no such need and stay
// unchanged.
export interface ItemTag {
  id: string;
  name: string;
}

export interface ItemLink {
  id: string;
  url: string;
  label: string | null;
}

export interface ItemAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  // Resolved eagerly below, same pattern as coverUrl -- a signed URL with
  // `{ download: filename }` baked in (issue #21's Constraints), so a plain
  // <a href> download saves under the real filename rather than the
  // opaque {attachment_id} storage path segment. Null only if signing
  // itself failed (transient Storage error), never as a sentinel for "no
  // attachment" -- every item_attachments row gets one.
  downloadUrl: string | null;
}

export interface ItemDetail {
  id: string;
  title: string;
  status: ItemStatus;
  rating: number | null;
  priority: PriorityLevel | null;
  notes: string | null;
  review: string | null;
  createdAt: string;
  completedAt: string | null;
  categoryId: string;
  subtypeId: string;
  subtypeName: string;
  tags: ItemTag[];
  coverUrl: string | null;
  links: ItemLink[];
  attachments: ItemAttachment[];
}

// Scoped to both `categoryId` (catches a URL whose `[category]` slug
// doesn't match the item's real category) and RLS's implicit `user_id =
// auth.uid()` (catches another user's item -- already indistinguishable
// from "doesn't exist", by design), plus `deleted_at IS NULL` (catches a
// soft-deleted item). A malformed-UUID `itemId` makes Postgres return a
// query error (invalid input syntax, not a thrown JS exception -- postgrest-
// js never throws for a query-level error) rather than data; that and every
// other case above all resolve to a `null` return here, so the route's
// `notFound()` call can't distinguish any of them. Reuses the same public-
// URL-for-cover resolution (resolvePublicCoverUrl, issue #38) and defensive
// embedded-resource normalization as getLibraryItems above, in one query
// per relation (no per-row N+1).
export async function getItemDetail(
  categoryId: string,
  itemId: string,
): Promise<ItemDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("items")
    .select(
      `
      id,
      title,
      status,
      rating,
      priority,
      notes,
      review,
      created_at,
      completed_at,
      category_id,
      subtype_id,
      subtypes ( name ),
      item_tags ( tags ( id, name ) ),
      item_images ( storage_path, is_cover, updated_at ),
      item_links ( id, url, label ),
      item_attachments ( id, filename, mime_type, size_bytes, storage_path )
    `,
    )
    .eq("id", itemId)
    .eq("category_id", categoryId)
    .is("deleted_at", null)
    // Links display in insertion order (issue #20's acceptance criteria) --
    // without this the embedded item_links resource had no explicit order
    // and relied on whatever order Postgres/PostgREST happened to return.
    .order("created_at", { referencedTable: "item_links", ascending: true })
    .maybeSingle();

  if (error || !data) {
    if (error) {
      // A malformed-UUID itemId lands here too -- logged like any other
      // transient read error, but still resolved to `null` (not-found)
      // below rather than being surfaced as a 500/unhandled error.
      console.error("Failed to load item detail:", error.message);
    }
    return null;
  }

  const subtype = Array.isArray(data.subtypes) ? data.subtypes[0] : data.subtypes;
  const images = Array.isArray(data.item_images) ? data.item_images : [];
  const coverImage = images.find((image) => image.is_cover);

  const coverUrl = coverImage ? resolvePublicCoverUrl(supabase, coverImage) : null;

  const tagRows = Array.isArray(data.item_tags) ? data.item_tags : [];
  const tags = tagRows
    .map((itemTag) => {
      const tag = Array.isArray(itemTag.tags) ? itemTag.tags[0] : itemTag.tags;
      return tag ? { id: tag.id, name: tag.name } : null;
    })
    .filter((tag): tag is ItemTag => tag !== null);

  const links = Array.isArray(data.item_links) ? data.item_links : [];
  const attachmentRows = Array.isArray(data.item_attachments) ? data.item_attachments : [];

  // Signed download URLs resolved eagerly, one per attachment, per-request
  // (never cached) -- the `attachments` bucket stays private (issue #38's
  // Out of scope), unlike `covers` above. `{ download: filename }` is what
  // makes the browser save under the real filename instead of the opaque
  // {attachment_id} path segment (issue #21's Constraints).
  const attachments = await Promise.all(
    attachmentRows.map(async (attachment) => {
      const { data: signed } = await supabase.storage
        .from("attachments")
        .createSignedUrl(attachment.storage_path, ATTACHMENT_SIGNED_URL_TTL_SECONDS, {
          download: attachment.filename,
        });
      return {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mime_type,
        sizeBytes: attachment.size_bytes,
        downloadUrl: signed?.signedUrl ?? null,
      };
    }),
  );

  return {
    id: data.id,
    title: data.title,
    status: data.status,
    rating: data.rating,
    priority: data.priority,
    notes: data.notes,
    review: data.review,
    createdAt: data.created_at,
    completedAt: data.completed_at,
    categoryId: data.category_id,
    subtypeId: data.subtype_id,
    subtypeName: subtype?.name ?? "",
    tags,
    coverUrl,
    links: links.map((link) => ({ id: link.id, url: link.url, label: link.label })),
    attachments,
  };
}
