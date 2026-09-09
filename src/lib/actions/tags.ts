"use server";

import { createClient } from "@/lib/supabase/server";
import { tagNameSchema } from "@/lib/validation/tags";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface TagResult {
  id: string;
  name: string;
}

export type AttachTagActionResult = { tag: TagResult } | { error: string };
export type DetachTagActionResult = { success: true } | { error: string };

// Ownership/not-found check, same shape as updateItemAction's in
// lib/actions/items.ts -- a request naming another user's item id (or a
// soft-deleted one) resolves to `null` here, exactly like a wholly
// nonexistent id, never a distinguishable error. Never relies on RLS
// (items_select_own) alone.
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

// Every tag visible to `userId` for the purposes of this module: global
// predefined rows (`user_id IS NULL`) plus the user's own custom rows. Same
// scope as getTags() (lib/queries/tags.ts), reimplemented locally here
// rather than imported -- that function makes its own auth.getUser() call,
// and every action below already has the user resolved before it needs this
// list, so importing it would mean a second, redundant round trip.
async function getVisibleTags(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<TagResult[]> {
  const { data } = await supabase
    .from("tags")
    .select("id, name")
    .or(`user_id.is.null,user_id.eq.${userId}`);
  return data ?? [];
}

function findByTrimmedCaseInsensitiveName(
  tags: TagResult[],
  target: string,
): TagResult | null {
  const normalized = target.trim().toLowerCase();
  return tags.find((tag) => tag.name.trim().toLowerCase() === normalized) ?? null;
}

// Attaches an already-known tag id (the autocomplete suggestion path --
// issue #17's "selecting a suggested existing tag" criterion). Its own
// immediate Server Action call: doesn't touch any other tag, doesn't require
// the item detail page's #16 Edit/Save toggle to be active.
export async function attachTagAction(
  itemId: string,
  tagId: string,
): Promise<AttachTagActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage tags." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  // Re-checked server-side against a tampered/direct submission: the tag
  // must actually be visible to this user (predefined or their own) -- a
  // request naming another user's private custom tag id resolves the same
  // as a nonexistent one. Belt-and-suspenders alongside the
  // item_tags_insert_own RLS policy's own tag-visibility check (#17's
  // migration), never relied on alone.
  const { data: tag } = await supabase
    .from("tags")
    .select("id, name")
    .eq("id", tagId)
    .or(`user_id.is.null,user_id.eq.${user.id}`)
    .maybeSingle();
  if (!tag) {
    return { error: "That tag could not be found." };
  }

  const { error } = await supabase
    .from("item_tags")
    .insert({ item_id: itemId, tag_id: tagId });

  // item_tags' primary key is (item_id, tag_id) -- attaching an
  // already-attached tag hits a 23505 unique-violation. Treated as a
  // no-op success (the tag ends up attached either way, which is already
  // true), never surfaced as an unhandled error.
  if (error && error.code !== "23505") {
    return { error: "Failed to attach tag. Please try again." };
  }

  return { tag };
}

// Detaches one tag from one item -- its own immediate Server Action call,
// independent of every other attached tag and of #16's Edit/Save toggle.
// Deletes only the item_tags row for this (item, tag) pair; never touches
// the tags row itself, whether predefined, the user's own, or the last item
// referencing it.
export async function detachTagAction(
  itemId: string,
  tagId: string,
): Promise<DetachTagActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage tags." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { error } = await supabase
    .from("item_tags")
    .delete()
    .eq("item_id", itemId)
    .eq("tag_id", tagId);

  if (error) {
    return { error: "Failed to remove tag. Please try again." };
  }

  return { success: true };
}

// The typed-name path: submitting free text either attaches an existing
// tag (app-level lookup-before-create, trimmed + case-insensitive, across
// predefined + this user's own custom tags) or creates one new user-owned
// `tags` row and attaches it -- in one action, per the issue's acceptance
// criteria. Re-validates with the same tagNameSchema the client pre-checks
// with, so a JS-disabled or hand-crafted direct submission is rejected the
// same way (empty/whitespace-only never reaches the database).
export async function addTagToItemAction(
  itemId: string,
  name: string,
): Promise<AttachTagActionResult> {
  const parsed = tagNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a tag name." };
  }
  const trimmedName = parsed.data.name;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage tags." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const visibleTags = await getVisibleTags(supabase, user.id);
  let tag = findByTrimmedCaseInsensitiveName(visibleTags, trimmedName);

  if (!tag) {
    // Stored as typed (trimmed) -- only the existence check above is
    // case-insensitive, not the stored value.
    const { data: inserted, error: insertError } = await supabase
      .from("tags")
      .insert({ name: trimmedName, user_id: user.id })
      .select("id, name")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // Race: another request created the same (lower(name), user_id)
        // tag between the lookup above and this insert -- the new
        // tags_lower_name_user_key unique index (migration
        // 20260909100000_add_tags_insert_policy_and_unique_index.sql)
        // caught it. Re-query and attach the tag that won the race instead
        // of surfacing the raw Postgres unique-violation error.
        const refreshed = await getVisibleTags(supabase, user.id);
        tag = findByTrimmedCaseInsensitiveName(refreshed, trimmedName);
        if (!tag) {
          return { error: "Failed to create tag. Please try again." };
        }
      } else {
        return { error: "Failed to create tag. Please try again." };
      }
    } else {
      tag = inserted;
    }
  }

  const { error: attachError } = await supabase
    .from("item_tags")
    .insert({ item_id: itemId, tag_id: tag.id });

  // Same no-op-on-duplicate handling as attachTagAction: unreachable through
  // the normal UI (the newly-created/matched tag can't already be attached
  // if it just got created, and an existing match was excluded from
  // suggestions already) but still defensively handled for a tampered
  // direct submission.
  if (attachError && attachError.code !== "23505") {
    return { error: "Failed to attach tag. Please try again." };
  }

  return { tag };
}
