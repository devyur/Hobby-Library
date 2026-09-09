"use server";

import { createClient } from "@/lib/supabase/server";
import { listNameSchema } from "@/lib/validation/lists";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ListResult {
  id: string;
  name: string;
}

export type CreateListActionResult = { list: ListResult } | { error: string };
export type RenameListActionResult = { success: true } | { error: string };
export type DeleteListActionResult = { success: true } | { error: string };
export type AddItemToListActionResult = { success: true } | { error: string };
export type RemoveItemFromListActionResult = { success: true } | { error: string };

// Ownership/not-found check for a list, same shape as getOwnedItem in
// lib/actions/tags.ts/links.ts -- a request naming another user's list id
// (or a nonexistent one) resolves to `null` here, exactly alike, never a
// distinguishable error. Never relies on RLS (lists_select_own/
// lists_update_own/lists_delete_own) alone.
async function getOwnedList(
  supabase: SupabaseServerClient,
  listId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  return list;
}

// Same shape as getOwnedItem in lib/actions/tags.ts/links.ts -- addItemToListAction
// needs to confirm the target item both exists, belongs to the caller, and
// isn't currently trashed before it can be freshly added to a list.
async function getOwnedItem(
  supabase: SupabaseServerClient,
  itemId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: item } = await supabase
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return item;
}

// Create (issue #26) -- ListsOverview.tsx's create control. Its own
// immediate Server Action call (no useActionState/redirect -- lists/page.tsx
// never navigates away on create, unlike createItemAction), matching
// ItemLinksEditor's "always-interactive" shape. Re-validates with the same
// listNameSchema the client pre-checks with, so a JS-disabled or
// hand-crafted direct submission is rejected the same way -- a
// blank/whitespace-only name never reaches the database. user_id is always
// the session's own auth.getUser() result, never taken from the client.
export async function createListAction(name: string): Promise<CreateListActionResult> {
  const parsed = listNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a list name." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to create a list." };
  }

  const { data: list, error } = await supabase
    .from("lists")
    .insert({ user_id: user.id, name: parsed.data.name })
    .select("id, name")
    .single();

  if (error || !list) {
    return { error: "Failed to create list. Please try again." };
  }

  return { list };
}

// Rename (issue #26) -- same immediate-call shape as createListAction, same
// listNameSchema re-check (identical blank/whitespace-only rejection).
// getOwnedList means a request naming another user's list id resolves to a
// plain not-found error, never a distinguishable one, and never relies on
// lists_update_own RLS alone.
export async function renameListAction(
  listId: string,
  name: string,
): Promise<RenameListActionResult> {
  const parsed = listNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a list name." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to rename a list." };
  }

  const list = await getOwnedList(supabase, listId, user.id);
  if (!list) {
    return { error: "This list could not be found." };
  }

  const { error } = await supabase
    .from("lists")
    .update({ name: parsed.data.name })
    .eq("id", listId);

  if (error) {
    return { error: "Failed to rename list. Please try again." };
  }

  return { success: true };
}

// Delete (issue #26) -- confirmed inline on lists/page.tsx, same "confirm
// step" precedent as item Delete on the item detail page / Trash's
// Permanent Delete (TrashList.tsx). Only the `lists` row is deleted here --
// its `list_items` rows disappear automatically via the existing `on delete
// cascade` FK (#6's migration, 20260908150000_create_lists_tables.sql); the
// `items` rows a deleted list referenced are never touched by this action.
export async function deleteListAction(listId: string): Promise<DeleteListActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to delete a list." };
  }

  const list = await getOwnedList(supabase, listId, user.id);
  if (!list) {
    return { error: "This list could not be found." };
  }

  const { error } = await supabase.from("lists").delete().eq("id", listId);
  if (error) {
    return { error: "Failed to delete list. Please try again." };
  }

  return { success: true };
}

// Add item (issue #26) -- the picker's own immediate Server Action call on
// lists/[listId]/page.tsx. Both the list and the item are explicitly
// re-checked for ownership here -- belt-and-suspenders alongside
// list_items_insert_own RLS's own two `exists` checks (both the parent list
// and the referenced item must belong to the caller, migration
// 20260908150000), never relied on alone, matching this codebase's
// established convention everywhere else.
//
// list_items' primary key is (list_id, item_id) -- adding an
// already-present item hits a 23505 unique-violation. Treated as a no-op
// success (the item ends up a member either way, which is already true),
// never surfaced as an unhandled error -- same pattern attachTagAction uses
// for item_tags' own PK collision (lib/actions/tags.ts).
export async function addItemToListAction(
  listId: string,
  itemId: string,
): Promise<AddItemToListActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage lists." };
  }

  const list = await getOwnedList(supabase, listId, user.id);
  if (!list) {
    return { error: "This list could not be found." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: listId, item_id: itemId });

  if (error && error.code !== "23505") {
    return { error: "Failed to add item to list. Please try again." };
  }

  return { success: true };
}

// Remove item (issue #26) -- a control on each member row on
// lists/[listId]/page.tsx. Deletes just the one `list_items` row
// (list_items_delete_own RLS, migration 20260908150000); the underlying
// `items` row is never touched. Ownership is checked via the list, not the
// item -- matches list_items' own RLS model, which scopes it through the
// parent list's owner (list_items has no user_id column of its own).
export async function removeItemFromListAction(
  listId: string,
  itemId: string,
): Promise<RemoveItemFromListActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage lists." };
  }

  const list = await getOwnedList(supabase, listId, user.id);
  if (!list) {
    return { error: "This list could not be found." };
  }

  const { error } = await supabase
    .from("list_items")
    .delete()
    .eq("list_id", listId)
    .eq("item_id", itemId);

  if (error) {
    return { error: "Failed to remove item from list. Please try again." };
  }

  return { success: true };
}
