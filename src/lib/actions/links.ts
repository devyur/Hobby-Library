"use server";

import { createClient } from "@/lib/supabase/server";
import { itemLinkSchema } from "@/lib/validation/links";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface LinkResult {
  id: string;
  url: string;
  label: string | null;
}

export type AddLinkActionResult = { link: LinkResult } | { error: string };
export type RemoveLinkActionResult = { success: true } | { error: string };

// Same ownership/not-found check as getOwnedItem in lib/actions/tags.ts,
// reimplemented locally (that module exports no shared helper): a request
// naming another user's item id (or a soft-deleted one) resolves to `null`
// here, exactly like a wholly nonexistent id, never a distinguishable error.
// Never relies on RLS (items_select_own) alone.
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

// Adds one source link to one item -- its own immediate Server Action call,
// independent of #16's Edit/Save toggle and of every other link on the
// item, matching attachTagAction's shape (lib/actions/tags.ts). Re-validates
// with the same itemLinkSchema the client pre-checks with, so a JS-disabled
// or hand-crafted direct submission is rejected the same way (malformed
// URL/non-http(s) scheme/empty URL never reaches the database).
export async function addLinkAction(
  itemId: string,
  url: string,
  label: string,
): Promise<AddLinkActionResult> {
  const parsed = itemLinkSchema.safeParse({ url, label });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid URL." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage links." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { data: link, error } = await supabase
    .from("item_links")
    .insert({ item_id: itemId, url: parsed.data.url, label: parsed.data.label })
    .select("id, url, label")
    .single();

  if (error || !link) {
    return { error: "Failed to add link. Please try again." };
  }

  return { link };
}

// Removes one link from one item -- its own immediate Server Action call,
// independent of every other link on the item and of #16's Edit/Save
// toggle, matching detachTagAction's shape (lib/actions/tags.ts). Deletes
// only the item_links row for this (item, link) pair, scoped to the
// caller's own item via getOwnedItem above -- never relies on
// item_links_delete_own RLS (#5's migration) as the only gate.
export async function removeLinkAction(
  itemId: string,
  linkId: string,
): Promise<RemoveLinkActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage links." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { error } = await supabase
    .from("item_links")
    .delete()
    .eq("item_id", itemId)
    .eq("id", linkId);

  if (error) {
    return { error: "Failed to remove link. Please try again." };
  }

  return { success: true };
}
