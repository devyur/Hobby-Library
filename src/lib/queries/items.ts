import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

// Reusable read query (issue #12), added alongside categories.ts rather than
// overloading it per the issue's own file constraints. Fetches every
// non-deleted item the signed-in user owns in one category, ordered
// created_at desc (fixed order -- user-controlled sorting is #24). RLS on
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

// Signed URLs are resolved per request rather than cached -- the `covers`
// bucket is private/path-scoped (database-schema.md §7), so getPublicUrl()
// is never used. 1 hour comfortably outlives a single page render/request.
const COVER_SIGNED_URL_TTL_SECONDS = 60 * 60;

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
export async function getLibraryItems(
  categoryId: string,
  searchTerm?: string,
  filters?: LibraryItemFilters,
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
      item_images ( storage_path, is_cover )
    `,
    )
    .eq("category_id", categoryId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

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

      let coverUrl: string | null = null;
      if (coverImage) {
        const { data: signed } = await supabase.storage
          .from("covers")
          .createSignedUrl(coverImage.storage_path, COVER_SIGNED_URL_TTL_SECONDS);
        coverUrl = signed?.signedUrl ?? null;
      }

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
// `notFound()` call can't distinguish any of them. Reuses the same signed-
// URL-for-cover pattern and defensive embedded-resource normalization as
// getLibraryItems above, in one query per relation (no per-row N+1).
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
      item_images ( storage_path, is_cover ),
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

  let coverUrl: string | null = null;
  if (coverImage) {
    const { data: signed } = await supabase.storage
      .from("covers")
      .createSignedUrl(coverImage.storage_path, COVER_SIGNED_URL_TTL_SECONDS);
    coverUrl = signed?.signedUrl ?? null;
  }

  const tagRows = Array.isArray(data.item_tags) ? data.item_tags : [];
  const tags = tagRows
    .map((itemTag) => {
      const tag = Array.isArray(itemTag.tags) ? itemTag.tags[0] : itemTag.tags;
      return tag ? { id: tag.id, name: tag.name } : null;
    })
    .filter((tag): tag is ItemTag => tag !== null);

  const links = Array.isArray(data.item_links) ? data.item_links : [];
  const attachmentRows = Array.isArray(data.item_attachments) ? data.item_attachments : [];

  // Signed download URLs resolved eagerly, one per attachment, same
  // per-request (never cached) reasoning as coverUrl above -- the
  // `attachments` bucket is private/path-scoped too. `{ download: filename }`
  // is what makes the browser save under the real filename instead of the
  // opaque {attachment_id} path segment (issue #21's Constraints).
  const attachments = await Promise.all(
    attachmentRows.map(async (attachment) => {
      const { data: signed } = await supabase.storage
        .from("attachments")
        .createSignedUrl(attachment.storage_path, COVER_SIGNED_URL_TTL_SECONDS, {
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
