import { createClient } from "@/lib/supabase/server";

// Reusable read queries for Custom Lists (issue #26), kept in their own
// module per the issue's own file constraints (mirrors lib/queries/trash.ts
// being split out from items.ts for the same "cross-cutting, not one
// category" reason). Explicit `.eq("user_id", user.id)` / ownership checks
// throughout, never relying on RLS (lists_select_own/list_items_select_own,
// migration 20260908150000_create_lists_tables.sql) alone -- same
// convention every other query in this codebase already follows.

const COVER_SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface ListSummary {
  id: string;
  name: string;
  // Counts only non-trashed member items (issue #26's explicit "trashed
  // items disappear from a list's display" rule) -- a list_items row for a
  // trashed item still exists, but never counts here.
  itemCount: number;
}

// lists/page.tsx's list-of-lists (issue #26). Two queries rather than one
// deeply-nested embed: `lists` for id/name, then a second `list_items`
// query (joined `items!inner` so `.is("items.deleted_at", null)` actually
// excludes trashed-item rows, not just reshapes the embed) to compute a
// per-list count in JS -- kept as two explicit steps for the same reason
// getLibraryItems (lib/queries/items.ts) resolves its tag-filter id list as
// its own query rather than one maximally-nested select.
export async function getLists(): Promise<ListSummary[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- middleware.ts already redirects an unauthenticated
    // request to /login before this route is ever reachable.
    return [];
  }

  const { data: lists, error } = await supabase
    .from("lists")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    // Swallowed rather than thrown, same convention as getTrashedItems/
    // getLibraryItems: a Lists page that renders empty because of a
    // transient read error is better than one that crashes outright.
    console.error("Failed to load lists:", error.message);
    return [];
  }
  if (!lists || lists.length === 0) return [];

  const listIds = lists.map((list) => list.id);

  const { data: memberRows, error: countError } = await supabase
    .from("list_items")
    .select("list_id, items!inner ( deleted_at )")
    .in("list_id", listIds)
    .is("items.deleted_at", null);

  if (countError) {
    console.error("Failed to count list items:", countError.message);
    // Degrade to zero counts rather than failing the whole page -- the
    // names/ids above are still real and useful on their own.
    return lists.map((list) => ({ id: list.id, name: list.name, itemCount: 0 }));
  }

  const counts = new Map<string, number>();
  for (const row of memberRows ?? []) {
    counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1);
  }

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    itemCount: counts.get(list.id) ?? 0,
  }));
}

export interface ListMemberItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  subtypeName: string;
  coverUrl: string | null;
}

export interface ListDetail {
  id: string;
  name: string;
  items: ListMemberItem[];
}

// lists/[listId]/page.tsx's detail read (issue #26). Ownership is checked
// against `lists` first (id + user_id, no `deleted_at` column on `lists` to
// filter) -- a request naming another user's list id or a nonexistent one
// resolves to `null` here, exactly alike, so the route's notFound() call
// can't distinguish them (same reasoning getItemDetail's header comment
// documents for [category]/[itemId]).
//
// Member items: `items!inner` turns the embed into an inner join so
// `.is("items.deleted_at", null)` genuinely excludes a trashed member's row
// (issue #26's explicit display rule) rather than just reshaping the
// embedded object -- the underlying list_items row for that trashed item is
// never touched by this read, only left out of what's returned. Ordered by
// `sort_order` ascending (issue #42: manual drag order, replacing the old
// `added_at desc`/newest-added-first read) -- `added_at` is kept as a
// secondary sort only, so rows that still share the column's `0` default
// (every row inserted before #42, or several dragged to the same spot
// before a save landed) fall back to a stable oldest-first order rather
// than an unspecified/database-dependent one.
export async function getListDetail(listId: string): Promise<ListDetail | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id, name")
    .eq("id", listId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (listError || !list) {
    if (listError) {
      // A malformed-UUID listId lands here too -- logged like any other
      // transient read error, but still resolved to `null` (not-found)
      // below rather than surfaced as a 500/unhandled error.
      console.error("Failed to load list:", listError.message);
    }
    return null;
  }

  const { data: memberRows, error: itemsError } = await supabase
    .from("list_items")
    .select(
      `
      added_at,
      items!inner (
        id,
        title,
        categories ( slug, name ),
        subtypes ( name ),
        item_images ( storage_path, is_cover )
      )
    `,
    )
    .eq("list_id", listId)
    .is("items.deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("added_at", { ascending: true });

  if (itemsError) {
    console.error("Failed to load list items:", itemsError.message);
    return { id: list.id, name: list.name, items: [] };
  }

  const items = await Promise.all(
    (memberRows ?? []).map(async (row) => {
      // Defensive embedded-resource normalization, same reasoning as
      // getItemDetail/getLibraryItems -- this project's types.ts is
      // generated by a fallback tool (see its header comment), not the
      // literal `supabase gen types` CLI.
      const item = Array.isArray(row.items) ? row.items[0] : row.items;
      if (!item) return null;

      const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
      const subtype = Array.isArray(item.subtypes) ? item.subtypes[0] : item.subtypes;
      const images = Array.isArray(item.item_images) ? item.item_images : [];
      const coverImage = images.find(
        (image: { storage_path: string; is_cover: boolean }) => image.is_cover,
      );

      let coverUrl: string | null = null;
      if (coverImage) {
        const { data: signed } = await supabase.storage
          .from("covers")
          .createSignedUrl(coverImage.storage_path, COVER_SIGNED_URL_TTL_SECONDS);
        coverUrl = signed?.signedUrl ?? null;
      }

      return {
        id: item.id,
        title: item.title,
        categorySlug: category?.slug ?? "",
        categoryName: category?.name ?? "",
        subtypeName: subtype?.name ?? "",
        coverUrl,
      };
    }),
  );

  return {
    id: list.id,
    name: list.name,
    items: items.filter((item): item is ListMemberItem => item !== null),
  };
}

export interface ListMembership {
  id: string;
  name: string;
  isMember: boolean;
}

// [category]/[itemId]/page.tsx's "Lists" shortcut section (issue #41) --
// every list the signed-in user owns, each flagged with whether the given
// item is already a member, so ItemListsEditor.tsx can render one checkbox
// per list without a per-list round trip. Same two-explicit-queries shape
// as getLists above (a `lists` read, then a `list_items` read joined in JS)
// rather than one deeply-nested embed. `list_items` has no user_id column
// of its own -- membership is scoped to the caller by narrowing to
// `listIds`, which is itself already `.eq("user_id", user.id)`-scoped, same
// ownership-through-the-parent-list convention
// addItemToListAction/removeItemFromListAction already use.
export async function getListsForItem(itemId: string): Promise<ListMembership[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- middleware.ts already redirects an unauthenticated
    // request to /login before this route is ever reachable.
    return [];
  }

  const { data: lists, error } = await supabase
    .from("lists")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    // Swallowed rather than thrown, same convention as getLists: an item
    // detail page that renders its Lists section empty because of a
    // transient read error is better than one that crashes outright.
    console.error("Failed to load lists for item:", error.message);
    return [];
  }
  if (!lists || lists.length === 0) return [];

  const listIds = lists.map((list) => list.id);

  const { data: memberRows, error: memberError } = await supabase
    .from("list_items")
    .select("list_id")
    .eq("item_id", itemId)
    .in("list_id", listIds);

  if (memberError) {
    console.error("Failed to load list memberships:", memberError.message);
    // Degrade to every checkbox unchecked rather than failing the whole
    // section -- the names/ids above are still real and useful on their
    // own, same degrade-on-error precedent as getLists' count query.
    return lists.map((list) => ({ id: list.id, name: list.name, isMember: false }));
  }

  const memberIds = new Set((memberRows ?? []).map((row) => row.list_id));

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    isMember: memberIds.has(list.id),
  }));
}

export interface AddableItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  subtypeName: string;
}

// The add-item picker's candidate list (issue #26) -- every one of the
// signed-in user's own non-deleted items across ALL categories, minus
// whatever's already a member of this list. Deliberately not
// search_item_ids()-backed (#22's RPC is hard-scoped to one category_id,
// per this issue's own Constraints) -- a plain per-user, non-deleted `items`
// query is sufficient for V1; any text narrowing happens client-side in
// ListItemPicker.tsx against this already-scoped list, not as a second
// server round trip.
export async function getAddableItems(listId: string): Promise<AddableItem[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberRows, error: memberError } = await supabase
    .from("list_items")
    .select("item_id")
    .eq("list_id", listId);

  if (memberError) {
    console.error("Failed to load list members:", memberError.message);
    return [];
  }

  const memberIds = (memberRows ?? []).map((row) => row.item_id);

  let query = supabase
    .from("items")
    .select(
      `
      id,
      title,
      categories ( slug, name ),
      subtypes ( name )
    `,
    )
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (memberIds.length > 0) {
    query = query.not("id", "in", `(${memberIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load addable items:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    const subtype = Array.isArray(row.subtypes) ? row.subtypes[0] : row.subtypes;

    return {
      id: row.id,
      title: row.title,
      categorySlug: category?.slug ?? "",
      categoryName: category?.name ?? "",
      subtypeName: subtype?.name ?? "",
    };
  });
}
