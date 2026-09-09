import { createClient } from "@/lib/supabase/server";

// Reusable read query (issue #25), cross-category by design -- unlike
// getLibraryItems (lib/queries/items.ts), which is always scoped to one
// category, the Trash page lists every one of the signed-in user's
// soft-deleted items regardless of category. Kept in its own module rather
// than added to items.ts per that file's own "or a new
// lib/queries/trash.ts if that would crowd the existing file" note in the
// issue's Constraints.
//
// Explicit `.eq("user_id", user.id)` rather than relying on RLS
// (items_select_own) alone -- same "never rely on RLS alone" convention
// every other query/action in this codebase already follows.
export interface TrashedItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  subtypeName: string;
  deletedAt: string;
}

export async function getTrashedItems(): Promise<TrashedItem[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- middleware.ts already redirects an unauthenticated
    // request to /login before this route is ever reachable.
    return [];
  }

  const { data, error } = await supabase
    .from("items")
    .select(
      `
      id,
      title,
      deleted_at,
      categories ( slug, name ),
      subtypes ( name )
    `,
    )
    .eq("user_id", user.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    // Swallowed rather than thrown, same convention as getLibraryItems/
    // getCategories: a Trash page that renders empty because of a transient
    // read error is better than one that crashes outright.
    console.error("Failed to load trashed items:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    // Defensive embedded-resource normalization, same reasoning as
    // getLibraryItems/getItemDetail -- this project's types.ts is generated
    // by a fallback tool (see its header comment), not the literal
    // `supabase gen types` CLI.
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    const subtype = Array.isArray(row.subtypes) ? row.subtypes[0] : row.subtypes;

    return {
      id: row.id,
      title: row.title,
      categorySlug: category?.slug ?? "",
      categoryName: category?.name ?? "",
      subtypeName: subtype?.name ?? "",
      deletedAt: row.deleted_at as string,
    };
  });
}
