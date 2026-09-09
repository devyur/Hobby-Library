import { createClient } from "@/lib/supabase/server";

// Reusable read query (issue #14). Fetches every subtype visible to the
// signed-in user -- global predefined rows (`user_id IS NULL`, seeded by
// supabase/seed.sql) plus the user's own custom rows (custom subtype
// creation shipped in #18, via lib/actions/subtypes.ts's
// createSubtypeAction -- this query only ever handles the read side) --
// with its `category_id`, so AddItemForm.tsx/ItemEditForm.tsx can filter the
// list client-side on
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

  // RLS on `subtypes` is `select using (user_id is null or user_id =
  // auth.uid())` (#18's migration tightened this from the original `using
  // (true)`) -- the explicit user_id filter below is no longer just
  // "intent"-documentation on top of a fully-open policy, but it's kept
  // regardless since it's still correct and this query needs no change from
  // how it already read.
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
