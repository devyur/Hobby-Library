"use server";

import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type RestoreItemActionResult = { success: true } | { error: string };
export type PermanentlyDeleteItemActionResult = { success: true } | { error: string };

// Restore/Permanent Delete's own ownership check (issue #25's Constraints):
// same shape as getOwnedItem in lib/actions/attachments.ts, but scoped to
// Trash instead of the live library -- `.not("deleted_at", "is", null)`
// instead of `.is("deleted_at", null)`, since the item must currently *be*
// in Trash for either action to apply to it. A request naming another
// user's item id, a never-deleted item, or one that's already been
// restored/permanently deleted by a racing click all resolve to `null`
// here, exactly alike -- never a distinguishable error.
async function getTrashedOwnedItem(
  supabase: SupabaseServerClient,
  itemId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: item } = await supabase
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  return item;
}

// Restore (issue #25) -- its own immediate Server Action call from
// TrashList.tsx, takes the item id directly (no other field travels with
// it), same useTransition + direct-call shape as removeAttachmentAction.
// Non-destructive, so no server-side confirmation state to manage -- just
// flips deleted_at back to NULL. A stale/duplicate click racing an
// already-restored or already-permanently-deleted row fails gracefully via
// getTrashedOwnedItem returning null above, not a crash or a phantom row.
export async function restoreItemAction(itemId: string): Promise<RestoreItemActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to restore an item." };
  }

  const item = await getTrashedOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item is no longer in Trash." };
  }

  const { error: updateError } = await supabase
    .from("items")
    .update({ deleted_at: null })
    .eq("id", itemId);
  if (updateError) {
    return { error: "Failed to restore this item. Please try again." };
  }

  return { success: true };
}

// Buckets both Delete triggers in this app write into (`covers` for the
// item's single cover object, `attachments` for its 0-10 file attachments --
// uploadCoverAction/uploadAttachmentAction, lib/actions/covers.ts and
// attachments.ts). Listed here rather than imported as shared constants
// since neither module exports its bucket name.
const STORAGE_BUCKETS = ["covers", "attachments"] as const;

// Deletes every Storage object under `{userId}/{itemId}/` in one bucket --
// one list() + one bulk remove() per bucket (issue #36's own constraint:
// "not per-file bookkeeping"), not tracked against any DB row (unlike
// removeAttachmentAction, which deletes one already-known storage_path).
// Returns an error string on failure, `null` on success -- including the
// empty-folder case, which this issue's own acceptance criteria says must
// still count as success ("an empty storage.list() result is not treated
// as an error"), same reasoning as the covers bucket's fixed
// `.../cover` path never existing for an item that has no cover.
async function clearStorageFolder(
  supabase: SupabaseServerClient,
  bucket: (typeof STORAGE_BUCKETS)[number],
  userId: string,
  itemId: string,
): Promise<string | null> {
  const folder = `${userId}/${itemId}`;
  const { data: entries, error: listError } = await supabase.storage.from(bucket).list(folder);
  if (listError) {
    return `Failed to check ${bucket} storage for this item. Please try again.`;
  }
  if (!entries || entries.length === 0) {
    return null;
  }

  const paths = entries.map((entry) => `${folder}/${entry.name}`);
  const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
  if (removeError) {
    return `Failed to remove ${bucket} storage objects for this item. Please try again.`;
  }

  return null;
}

// Permanent Delete (issue #25, folding in #36's Storage-cleanup scope) --
// its own immediate Server Action call from TrashList.tsx's inline
// confirmation panel, same direct-itemId shape as restoreItemAction above.
//
// Storage cleanup runs in *both* buckets and must fully succeed *before* the
// real `DELETE` on the `items` row below: if either bucket's cleanup fails,
// this returns early with an error and the row is left exactly as it was
// (still in Trash, still restorable, retryable) -- nothing is silently
// orphaned. Mirrors removeAttachmentAction's storage-then-row ordering
// (lib/actions/attachments.ts) exactly, just for two buckets instead of one.
//
// No TOCTOU window between the list() and remove() calls inside
// clearStorageFolder: every path that can write into either bucket's
// `{userId}/{itemId}/` folder (uploadCoverAction, uploadAttachmentAction)
// already requires the target item to have `deleted_at IS NULL`, and this
// item is already soft-deleted (that's the only way it could be in Trash to
// begin with) -- so nothing can add a new object to either folder between
// this action's two storage calls, or between separate retries of it.
//
// item_tags/item_images/item_links/item_attachments/list_items rows are
// never touched explicitly here -- the items row's own cascading FKs (all
// `on delete cascade`, migrations 20260908130000/20260908140000/
// 20260908150000) remove them automatically once the row itself is deleted.
export async function permanentlyDeleteItemAction(
  itemId: string,
): Promise<PermanentlyDeleteItemActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to delete an item." };
  }

  const item = await getTrashedOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item is no longer in Trash." };
  }

  for (const bucket of STORAGE_BUCKETS) {
    const storageError = await clearStorageFolder(supabase, bucket, user.id, itemId);
    if (storageError) {
      return { error: storageError };
    }
  }

  const { error: deleteError } = await supabase.from("items").delete().eq("id", itemId);
  if (deleteError) {
    return { error: "Failed to permanently delete this item. Please try again." };
  }

  return { success: true };
}
