import { createClient } from "@/lib/supabase/server";

// Reusable read query (issue #14). Fetches every subtype visible to the
// signed-in user -- global predefined rows (`user_id IS NULL`, seeded by
// supabase/seed.sql) plus the user's own custom rows (none can exist yet;
// custom subtype creation is #18, out of scope here) -- with its
// `category_id`, so AddItemForm.tsx can filter the list client-side on
// category change (subtypes_and_tags.md's full predefined set is ≤14 per
// category / ~46 total, small enough to fetch once and filter in the
// browser rather than round-tripping on every category change, per the
// issue's own guidance).
//
// Ordered by created_at (insertion order), not name: supabase/seed.sql
// inserts each category's subtypes in the exact order subtypes-and-tags.md
// lists them, ending in "Other" -- alphabetical order would both scramble
// that intentional ordering and separate "Other" from the end of the list.
export interface SubtypeOption {
  id: string;
  categoryId: string;
  name: string;
}

export async function getSubtypes(): Promise<SubtypeOption[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS on `subtypes` is `select using (true)` (every row is visible to
  // every authenticated user, per the reference-tables migration) -- the
  // explicit user_id filter below isn't load-bearing against the database,
  // but keeps this query's *intent* ("what this user should see") honest
  // and matches the issue's stated scope, independent of how permissive the
  // table's RLS policy happens to be today.
  let query = supabase.from("subtypes").select("id, category_id, name");
  query = user
    ? query.or(`user_id.is.null,user_id.eq.${user.id}`)
    : query.is("user_id", null);

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    // Swallowed rather than thrown, same convention as getCategories: a
    // broken Add form (empty Subtype options) is better than a page that
    // fails to render at all because of a transient read error.
    console.error("Failed to load subtypes:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
  }));
}
