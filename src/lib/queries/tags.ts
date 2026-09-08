import { createClient } from "@/lib/supabase/server";

// Reusable read query (issue #14). Fetches every tag visible to the
// signed-in user -- global predefined rows (`user_id IS NULL`, seeded by
// supabase/seed.sql) plus the user's own custom rows (none can exist yet;
// custom tag creation is #17, out of scope here) -- for the Full Add form's
// existing-tags-only multi-select. Ordered alphabetically: unlike subtypes,
// there's no seed-order convention worth preserving for a flat 24-tag
// checkbox list.
export interface TagOption {
  id: string;
  name: string;
}

export async function getTags(): Promise<TagOption[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Same note as getSubtypes(): `tags` RLS is `select using (true)`, so this
  // filter documents intent rather than narrowing what the database would
  // otherwise return.
  let query = supabase.from("tags").select("id, name");
  query = user
    ? query.or(`user_id.is.null,user_id.eq.${user.id}`)
    : query.is("user_id", null);

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    console.error("Failed to load tags:", error.message);
    return [];
  }

  return data ?? [];
}
