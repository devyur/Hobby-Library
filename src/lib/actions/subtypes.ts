"use server";

import { createClient } from "@/lib/supabase/server";
import { subtypeNameSchema } from "@/lib/validation/subtypes";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface SubtypeResult {
  id: string;
  name: string;
}

export type CreateSubtypeActionResult = { subtype: SubtypeResult } | { error: string };

// Every subtype visible to `userId` within one category: global predefined
// rows (`user_id IS NULL`) plus the user's own custom rows for that same
// category_id -- same scope as getSubtypes() (lib/queries/subtypes.ts),
// narrowed to one category and reimplemented locally rather than imported,
// same reasoning as tags.ts's getVisibleTags (that function makes its own
// auth.getUser() call, redundant here since the user is already resolved).
async function getVisibleSubtypesForCategory(
  supabase: SupabaseServerClient,
  userId: string,
  categoryId: string,
): Promise<SubtypeResult[]> {
  const { data } = await supabase
    .from("subtypes")
    .select("id, name")
    .eq("category_id", categoryId)
    .or(`user_id.is.null,user_id.eq.${userId}`);
  return data ?? [];
}

function findByTrimmedCaseInsensitiveName(
  subtypes: SubtypeResult[],
  target: string,
): SubtypeResult | null {
  const normalized = target.trim().toLowerCase();
  return subtypes.find((subtype) => subtype.name.trim().toLowerCase() === normalized) ?? null;
}

// The "create new subtype" path for both the Full Add form (#14) and item
// edit's new Subtype picker (#16 left it read-only; this issue adds it).
// Unlike addTagToItemAction (lib/actions/tags.ts), there is no item to
// attach to here -- a subtype is a single FK on `items`, not a join-table
// relation -- so this only ever create-or-finds the `subtypes` row itself
// and returns it; the caller (a client component) is responsible for
// selecting it in its own picker state, and for an item-edit save actually
// persisting it via updateItemAction.
//
// Lookup-before-create is trimmed + case-insensitive and scoped to
// `categoryId`, per the issue's acceptance criteria -- a same-named subtype
// in a different category is never treated as a duplicate, matching
// subtypes_category_lower_name_user_key's own (category_id, lower(name),
// user_id) scope.
export async function createSubtypeAction(
  categoryId: string,
  name: string,
): Promise<CreateSubtypeActionResult> {
  const parsed = subtypeNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a subtype name." };
  }
  const trimmedName = parsed.data.name;

  if (typeof categoryId !== "string" || categoryId.trim() === "") {
    return { error: "Select a category first." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage subtypes." };
  }

  const { data: category } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category) {
    return { error: "Selected category does not exist." };
  }

  const visibleSubtypes = await getVisibleSubtypesForCategory(supabase, user.id, categoryId);
  let subtype = findByTrimmedCaseInsensitiveName(visibleSubtypes, trimmedName);

  if (!subtype) {
    // Stored as typed (trimmed) -- only the existence check above is
    // case-insensitive, not the stored value.
    const { data: inserted, error: insertError } = await supabase
      .from("subtypes")
      .insert({ name: trimmedName, user_id: user.id, category_id: categoryId })
      .select("id, name")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // Race: another request created the same (category_id, lower(name),
        // user_id) subtype between the lookup above and this insert --
        // subtypes_category_lower_name_user_key (from #3's original
        // migration) caught it. Re-query and use the row that won the race
        // instead of surfacing the raw Postgres unique-violation error.
        const refreshed = await getVisibleSubtypesForCategory(supabase, user.id, categoryId);
        subtype = findByTrimmedCaseInsensitiveName(refreshed, trimmedName);
        if (!subtype) {
          return { error: "Failed to create subtype. Please try again." };
        }
      } else {
        return { error: "Failed to create subtype. Please try again." };
      }
    } else {
      subtype = inserted;
    }
  }

  return { subtype };
}
