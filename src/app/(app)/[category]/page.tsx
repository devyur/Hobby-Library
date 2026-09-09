import { notFound } from "next/navigation";

import { LibraryView, type ViewMode } from "@/components/items/LibraryView";
import { getLibraryItems } from "@/lib/queries/items";
import { getSubtypes } from "@/lib/queries/subtypes";
import { getTags } from "@/lib/queries/tags";
import { createClient } from "@/lib/supabase/server";

// Category library view (issue #12): replaces the #10 stub. Keeps the
// existing slug->category lookup and notFound() for an unknown slug
// unchanged, then queries every non-deleted item the signed-in user owns in
// that category (RLS already scopes this to auth.uid(), see
// database-schema.md §4) plus their persisted list_view_mode preference,
// and hands both to the client-side LibraryView for rendering + the
// List/Card toggle. `categoryId` is passed through too (issue #22) --
// LibraryView's search box needs it for the searchLibraryItemsAction calls
// it makes as the user types, scoping every re-query to this same category.
//
// subtypes/tags (issue #23): fetched here the same way AddItemForm's own
// page does -- getSubtypes() returns every subtype visible to the user
// across all categories, and LibraryView filters that list down to this
// category client-side (the same reactive-subtype-list pattern the Full Add
// form already uses), rather than a category-scoped query. getTags() is
// already unscoped to any category.
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;

  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  if (!category) {
    notFound();
  }

  // middleware.ts (#9) already redirects unauthenticated requests to
  // /login before this ever renders, so `user` being present here is
  // expected -- but items/preferences reads below need the id, so this
  // guards the (defensive-only, e.g. an expired session) null case the
  // same way settings/page.tsx does.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [items, preferences, subtypes, tags] = await Promise.all([
    getLibraryItems(category.id),
    user
      ? supabase
          .from("user_preferences")
          .select("list_view_mode")
          .eq("user_id", user.id)
          .maybeSingle()
          .then(({ data }) => data)
      : Promise.resolve(null),
    getSubtypes(),
    getTags(),
  ]);

  const initialViewMode: ViewMode =
    preferences?.list_view_mode === "card" ? "card" : "list";

  return (
    <LibraryView
      categoryId={category.id}
      categoryName={category.name}
      categorySlug={slug}
      items={items}
      initialViewMode={initialViewMode}
      subtypes={subtypes}
      tags={tags}
    />
  );
}
