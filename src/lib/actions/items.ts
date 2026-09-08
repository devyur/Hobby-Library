"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { addItemSchema, type ItemFormState } from "@/lib/validation/items";

// Same shape as auth.ts's zodFieldErrors -- duplicated locally rather than
// imported, since this "use server" module and lib/actions/auth.ts are
// otherwise unrelated and lib/validation/*.ts is where shared shapes
// (ItemFormState) already live.
function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

// Server Action backing AddItemForm.tsx (issue #14). Re-validates with the
// same Zod schema the client pre-checks with (a JS-disabled or hand-crafted
// direct invocation of this action must still be rejected the same way),
// then does two more checks a Zod schema can't express on its own before
// ever writing to the database:
//
//   1. subtype_id actually belongs to category_id -- the UI's cascading
//      dropdown makes this unreachable through the form, but a tampered
//      submission (devtools-edited <option value>, or a direct action
//      invocation) could still send a mismatched pair. Checked explicitly
//      here *before* the insert, so a mismatch never even reaches the
//      items_check_subtype_category trigger (migration
//      20260908130000_create_items_table.sql) -- but that trigger's
//      exception is still caught below as a second line of defense, in
//      case this check and the trigger's rule ever drift apart.
//   2. every tagId actually exists -- same tampered-submission concern for
//      the tag checkbox group.
//
// user_id is never taken from the client -- always the session's own
// auth.getUser() result, so this can't be spoofed into creating an item for
// another user (items_insert_own's RLS check would reject it anyway, but
// this avoids relying on that alone).
export async function createItemAction(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const parsed = addItemSchema.safeParse({
    title: formData.get("title"),
    categoryId: formData.get("categoryId"),
    subtypeId: formData.get("subtypeId"),
    status: formData.get("status"),
    rating: formData.get("rating"),
    priority: formData.get("priority"),
    tagIds: formData.getAll("tagIds"),
    notes: formData.get("notes"),
    review: formData.get("review"),
  });

  if (!parsed.success) {
    return { formError: null, fieldErrors: zodFieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- middleware.ts already redirects an unauthenticated
    // request to /login before this route/action is ever reachable.
    return { formError: "You must be signed in to add an item.", fieldErrors: {} };
  }

  const { data: category } = await supabase
    .from("categories")
    .select("id, slug")
    .eq("id", parsed.data.categoryId)
    .maybeSingle();
  if (!category) {
    return {
      formError: null,
      fieldErrors: { categoryId: "Selected category does not exist" },
    };
  }

  const { data: subtype } = await supabase
    .from("subtypes")
    .select("id")
    .eq("id", parsed.data.subtypeId)
    .eq("category_id", parsed.data.categoryId)
    .maybeSingle();
  if (!subtype) {
    return {
      formError: null,
      fieldErrors: {
        subtypeId: "Selected subtype does not belong to the selected category",
      },
    };
  }

  if (parsed.data.tagIds.length > 0) {
    const { data: validTags } = await supabase
      .from("tags")
      .select("id")
      .in("id", parsed.data.tagIds);
    if (!validTags || validTags.length !== parsed.data.tagIds.length) {
      return {
        formError: null,
        fieldErrors: { tagIds: "One or more selected tags no longer exist" },
      };
    }
  }

  const { data: item, error: insertError } = await supabase
    .from("items")
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      category_id: parsed.data.categoryId,
      subtype_id: parsed.data.subtypeId,
      status: parsed.data.status,
      rating: parsed.data.rating ?? null,
      priority: parsed.data.priority ?? null,
      notes: parsed.data.notes ?? null,
      review: parsed.data.review ?? null,
    })
    .select("id")
    .single();

  if (insertError || !item) {
    // Second line of defense against items_check_subtype_category (see the
    // function comment above) -- not expected to ever fire given the
    // explicit cross-check above, but a raw Postgres exception must never
    // surface as an unhandled 500 either way.
    if (insertError?.message.includes("does not belong to category_id")) {
      return {
        formError: null,
        fieldErrors: {
          subtypeId: "Selected subtype does not belong to the selected category",
        },
      };
    }
    return {
      formError: insertError?.message ?? "Failed to create the item. Please try again.",
      fieldErrors: {},
    };
  }

  if (parsed.data.tagIds.length > 0) {
    const { error: tagError } = await supabase
      .from("item_tags")
      .insert(parsed.data.tagIds.map((tagId) => ({ item_id: item.id, tag_id: tagId })));

    if (tagError) {
      // Roll back the just-created item rather than leave it stranded with
      // none of the tags the user asked for -- no half-created row survives
      // a failed submission.
      await supabase.from("items").delete().eq("id", item.id);
      return { formError: "Failed to save tags. Please try again.", fieldErrors: {} };
    }
  }

  redirect(`/${category.slug}/${item.id}`);
}
