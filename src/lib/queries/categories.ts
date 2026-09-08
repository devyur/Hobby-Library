import { createClient } from "@/lib/supabase/server";

// Reusable read query (issue #10, acceptance criteria B / project-structure.md
// §4's stated purpose for lib/queries/). Selects the columns the nav shell
// (and the [category]/page.tsx stub) need, ordered by `sort_order` -- the
// same order the seeded data from #3 defines for the four V1 categories.
// Nothing here hardcodes a category name/slug (AGENTS.md): callers get back
// whatever rows exist in the table.
export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
}

export async function getCategories(): Promise<CategorySummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("categories")
    .select("id, slug, name")
    .order("sort_order", { ascending: true });

  if (error) {
    // Swallowed rather than thrown: a nav shell that fails to render at all
    // because of a transient read error is worse than one that renders with
    // no category tabs -- every other nav destination (Dashboard, Custom
    // Lists, Trash, Settings) is unaffected.
    console.error("Failed to load categories:", error.message);
    return [];
  }

  return data ?? [];
}
