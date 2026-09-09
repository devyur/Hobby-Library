"use server";

import { redirect } from "next/navigation";

import {
  getLibraryItems,
  type LibraryItem,
  type LibraryItemFilters,
  type LibrarySort,
} from "@/lib/queries/items";
import { createClient } from "@/lib/supabase/server";
import {
  addItemSchema,
  editItemSchema,
  quickAddItemSchema,
  type DeleteItemActionState,
  type ItemFormState,
} from "@/lib/validation/items";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Matches the itemStatusValues/priorityLevelValues literal unions in
// lib/validation/items.ts (not imported from there since those are kept
// local/unexported to that module) and the items table's own
// item_status/priority_level Postgres enums -- narrower than `string` so
// the insert below type-checks against the generated Supabase types.
type ItemStatus = "planned" | "ongoing" | "completed" | "dropped";
type PriorityLevel = "low" | "medium" | "high";

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

// Shared insert helper (issue #15's constraint: the actual `items` row
// write must not be duplicated between createItemAction below and
// quickAddItemAction further down). Callers are responsible for their own
// pre-insert validation (category exists, subtype belongs to category,
// tags exist, etc.) -- this only performs the insert itself and classifies
// the one failure mode a caller can't already rule out client-side: the
// items_check_subtype_category trigger (migration
// 20260908130000_create_items_table.sql) rejecting a category/subtype
// mismatch that slipped past an explicit pre-check (or wasn't checked at
// all, as in quickAddItemAction, which trusts its own just-resolved
// subtype).
async function insertItemRow(
  supabase: SupabaseServerClient,
  params: {
    userId: string;
    categoryId: string;
    subtypeId: string;
    title: string;
    status: ItemStatus;
    rating?: number | null;
    priority?: PriorityLevel | null;
    notes?: string | null;
    review?: string | null;
  },
): Promise<{ item: { id: string } } | { error: "subtype_category_mismatch" | string }> {
  const { data: item, error: insertError } = await supabase
    .from("items")
    .insert({
      user_id: params.userId,
      title: params.title,
      category_id: params.categoryId,
      subtype_id: params.subtypeId,
      status: params.status,
      rating: params.rating ?? null,
      priority: params.priority ?? null,
      notes: params.notes ?? null,
      review: params.review ?? null,
    })
    .select("id")
    .single();

  if (insertError || !item) {
    if (insertError?.message.includes("does not belong to category_id")) {
      return { error: "subtype_category_mismatch" };
    }
    return { error: insertError?.message ?? "Failed to create the item. Please try again." };
  }

  return { item };
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

  const result = await insertItemRow(supabase, {
    userId: user.id,
    categoryId: parsed.data.categoryId,
    subtypeId: parsed.data.subtypeId,
    title: parsed.data.title,
    status: parsed.data.status,
    rating: parsed.data.rating,
    priority: parsed.data.priority,
    notes: parsed.data.notes,
    review: parsed.data.review,
  });

  if ("error" in result) {
    // Second line of defense against items_check_subtype_category (see
    // insertItemRow's comment above) -- not expected to ever fire given the
    // explicit cross-check above, but a raw Postgres exception must never
    // surface as an unhandled 500 either way.
    if (result.error === "subtype_category_mismatch") {
      return {
        formError: null,
        fieldErrors: {
          subtypeId: "Selected subtype does not belong to the selected category",
        },
      };
    }
    return { formError: result.error, fieldErrors: {} };
  }

  const item = result.item;

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

// Server Action backing QuickAddForm.tsx (issue #15). Same client-pre-check
// + server-re-check shape as createItemAction above, but with only two
// inputs -- title and categoryId -- coming from the client at all:
//
//   - status is hardcoded to "planned" here, never read from the form.
//   - subtype_id is resolved server-side to the selected category's
//     predefined "Other" row (`user_id IS NULL AND name = 'Other'`,
//     per subtypes-and-tags.md) -- the client has no subtype input and
//     this action never reads a client-supplied subtype_id, so there is
//     nothing here for a tampered submission to override.
//
// Per subtypes-and-tags.md all four V1 categories' predefined subtype
// lists end in "Other", so this lookup is expected to always succeed --
// but if it doesn't (data drift), the failure is a clean formError, never
// an unhandled 500 or a row inserted with a missing/invalid subtype_id.
export async function quickAddItemAction(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const parsed = quickAddItemSchema.safeParse({
    title: formData.get("title"),
    categoryId: formData.get("categoryId"),
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

  const { data: otherSubtype } = await supabase
    .from("subtypes")
    .select("id")
    .eq("category_id", category.id)
    .is("user_id", null)
    .eq("name", "Other")
    .maybeSingle();
  if (!otherSubtype) {
    return {
      formError:
        "This category doesn't have a default subtype set up yet, so Quick Add can't be used for it right now. Try Add item instead.",
      fieldErrors: {},
    };
  }

  const result = await insertItemRow(supabase, {
    userId: user.id,
    categoryId: category.id,
    subtypeId: otherSubtype.id,
    title: parsed.data.title,
    status: "planned",
  });

  if ("error" in result) {
    // The subtype above was just resolved by this action itself (not
    // client input), so a mismatch is not expected -- but insertItemRow's
    // trigger-error classification is handled the same defensive way as
    // createItemAction, rather than assumed unreachable.
    const message =
      result.error === "subtype_category_mismatch"
        ? "Something went wrong adding this item. Please try again."
        : result.error;
    return { formError: message, fieldErrors: {} };
  }

  redirect(`/${category.slug}`);
}

// Server Action backing ItemEditForm.tsx (issue #16; subtype editing added
// in #18), bound to a specific item id via `.bind(null, itemId)` in the
// client component -- so its real signature as passed to useActionState is
// (prevState, formData), same shape as createItemAction/quickAddItemAction
// above. status, rating, priority, subtype_id, notes, and review are read
// from the client -- title and category_id remain permanently out of scope
// for editing (see the issue's Out of scope section) and never appear in the
// update payload, and completed_at is never written here either (out of
// scope, filed as #34) -- it stays whatever it already was.
//
// Same client-pre-check + server-re-check shape as createItemAction: a
// JS-disabled or hand-crafted direct submission is rejected the same way.
//
// Ownership/not-found: never relies on the items_update_own RLS policy
// (user_id = auth.uid()) as the only check -- the explicit
// .eq("user_id", user.id).is("deleted_at", null) below means a request
// naming another user's item id (or a soft-deleted one) gets the same
// plain "not found" formError a raw RLS-filtered zero-row result would
// produce anyway, never a distinguishable Postgres/RLS error.
//
// Explicit-null clearing: parsed.data.rating/priority/notes/review are
// `T | undefined` (the Zod schema's emptyToUndefined preprocessing), and
// `value ?? null` below turns each `undefined` into an explicit `null` in
// the object literal -- the key is always present in the update payload,
// never omitted. This matters because Supabase's `.update()` only touches
// keys present in its argument object; an omitted (or `undefined`-valued,
// which JSON.stringify drops entirely) key leaves the existing DB value
// untouched instead of clearing it.
export async function updateItemAction(
  itemId: string,
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const parsed = editItemSchema.safeParse({
    status: formData.get("status"),
    subtypeId: formData.get("subtypeId"),
    rating: formData.get("rating"),
    priority: formData.get("priority"),
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
    return { formError: "You must be signed in to edit an item.", fieldErrors: {} };
  }

  // Existence + ownership + not-soft-deleted, all in one query -- same
  // not-found semantics getItemDetail (lib/queries/items.ts) already
  // applies for the read side. A request naming another user's item id (or
  // one that's been soft-deleted) resolves to `null` here, exactly like a
  // wholly nonexistent id -- never a distinguishable error.
  const { data: item } = await supabase
    .from("items")
    .select("id, category_id")
    .eq("id", itemId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!item) {
    return { formError: "This item could not be found.", fieldErrors: {} };
  }

  const { data: category } = await supabase
    .from("categories")
    .select("slug")
    .eq("id", item.category_id)
    .maybeSingle();
  if (!category) {
    return { formError: "This item could not be found.", fieldErrors: {} };
  }

  // subtype_id must belong to the item's own (unchanged) category_id and be
  // visible to this user -- predefined (user_id IS NULL) or their own custom
  // row -- same cross-check createItemAction runs before its insert. The
  // Subtype picker's own options list already only ever offers this
  // category's subtypes, so a mismatch is unreachable through normal
  // interaction, but a tampered/direct submission could still send one.
  // items_check_subtype_category's trigger (#18's migration) would also
  // reject this at the database level, but that's a second line of defense,
  // never relied on alone -- same belt-and-suspenders reasoning as
  // createItemAction.
  const { data: subtype } = await supabase
    .from("subtypes")
    .select("id")
    .eq("id", parsed.data.subtypeId)
    .eq("category_id", item.category_id)
    .or(`user_id.is.null,user_id.eq.${user.id}`)
    .maybeSingle();
  if (!subtype) {
    return {
      formError: null,
      fieldErrors: {
        subtypeId: "Selected subtype does not belong to this item's category",
      },
    };
  }

  const { error: updateError } = await supabase
    .from("items")
    .update({
      status: parsed.data.status,
      subtype_id: parsed.data.subtypeId,
      rating: parsed.data.rating ?? null,
      priority: parsed.data.priority ?? null,
      notes: parsed.data.notes ?? null,
      review: parsed.data.review ?? null,
    })
    .eq("id", itemId);

  if (updateError) {
    // Second line of defense against items_check_subtype_category (see the
    // explicit cross-check above) -- not expected to ever fire given that
    // check, but a raw Postgres exception must never surface as an
    // unhandled 500 either way. Same message-sniffing pattern insertItemRow
    // uses for the same trigger.
    if (updateError.message.includes("does not belong to category_id")) {
      return {
        formError: null,
        fieldErrors: {
          subtypeId: "Selected subtype does not belong to this item's category",
        },
      };
    }
    return { formError: "Failed to save changes. Please try again.", fieldErrors: {} };
  }

  redirect(`/${category.slug}/${itemId}`);
}

// Server Action backing ItemEditForm.tsx's Delete control (issue #25) --
// bound to a specific item id via `.bind(null, itemId)`, same shape
// updateItemAction uses, and wired through useActionState/`<form
// action={...}>` so its redirect-on-success behaves exactly like
// updateItemAction's own post-save redirect. Only ever reachable from the
// page's view mode (ItemEditForm never renders the Delete control while
// isEditing is true).
//
// This is the first delete trigger anywhere in the app, and it's a *soft*
// delete: only items.deleted_at is written here. item_tags/item_images/
// item_links/item_attachments/list_items are never touched, so a later
// Restore (lib/actions/trash.ts) brings the item back exactly as it was.
//
// Ownership/not-found: same .eq("user_id", user.id).is("deleted_at", null)
// check as updateItemAction -- a request naming another user's item id (or
// one that's already soft-deleted) resolves to the same plain not-found
// error, never a distinguishable one.
export async function deleteItemAction(
  itemId: string,
  _prevState: DeleteItemActionState,
  _formData: FormData,
): Promise<DeleteItemActionState> {
  // Neither is read -- there's no field to validate for a Delete confirm
  // click, just an item id already bound into this action -- but both stay
  // in the signature since useActionState always calls its action as
  // (prevState, formData). Referenced here (not just underscore-prefixed)
  // to keep `npm run lint` clean, same pattern the mocked Storage call
  // signatures in lib/actions/covers.test.ts/attachments.test.ts already use.
  void _prevState;
  void _formData;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- middleware.ts already redirects an unauthenticated
    // request to /login before this route/action is ever reachable.
    return { error: "You must be signed in to delete an item." };
  }

  const { data: item } = await supabase
    .from("items")
    .select("id, category_id")
    .eq("id", itemId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { data: category } = await supabase
    .from("categories")
    .select("slug")
    .eq("id", item.category_id)
    .maybeSingle();
  if (!category) {
    return { error: "This item could not be found." };
  }

  const { error: updateError } = await supabase
    .from("items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", itemId);
  if (updateError) {
    return { error: "Failed to delete this item. Please try again." };
  }

  // Same "redirect back to a real page after the write" convention as
  // updateItemAction/quickAddItemAction -- the item's own detail page 404s
  // for anyone once deleted_at is set (getItemDetail's existing
  // .is("deleted_at", null) filter), so this redirects to the category
  // library view instead, matching the issue's own acceptance criteria.
  redirect(`/${category.slug}`);
}

// Server Action backing LibraryView.tsx's search box (issue #22). A thin
// wrapper, not a parallel query -- LibraryView is a client component, and
// getLibraryItems (lib/queries/items.ts) uses createClient()/next/headers'
// cookies(), which only resolves in a server context. Every actual bit of
// matching logic lives in getLibraryItems/search_item_ids() (the DB RPC);
// this action exists solely so the client can invoke that server-only code
// path.
export async function searchLibraryItemsAction(
  categoryId: string,
  searchTerm: string,
  sort?: LibrarySort,
): Promise<LibraryItem[]> {
  return getLibraryItems(categoryId, searchTerm, undefined, sort);
}

// Server Action backing LibraryView.tsx's filter controls (issue #23) --
// alongside searchLibraryItemsAction above, same thin-wrapper reasoning
// (LibraryView is a client component; getLibraryItems needs server
// context). Takes the search term too (not just filters) so LibraryView can
// route both the search box and the four filter controls through this one
// action -- one combined query per the issue's own "read from the same
// combined query, not two independent, later-merged lists" requirement --
// rather than reconciling this action's results with a separate
// searchLibraryItemsAction call. `sort` (issue #24) rides along the same
// combined action -- LibraryView's one debounced effect reads search term,
// filters, AND sort together, so sort composes on top of the filtered/
// searched result set rather than requiring a second round trip.
export async function filterLibraryItemsAction(
  categoryId: string,
  searchTerm: string,
  filters: LibraryItemFilters,
  sort?: LibrarySort,
): Promise<LibraryItem[]> {
  return getLibraryItems(categoryId, searchTerm, filters, sort);
}
