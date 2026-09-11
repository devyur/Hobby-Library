"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  COVER_SIZE_ERROR,
  COVER_TYPE_ERROR,
  MAX_COVER_SIZE_BYTES,
  isAllowedCoverMimeType,
  type UploadCoverActionState,
} from "@/lib/validation/covers";

// Server Action backing CoverUploadControl.tsx (issue #19), attached at the
// item detail page's CoverThumbnail spot -- not inside ItemEditForm.tsx,
// whose own header comment says cover stays out of scope for editing there
// (#16's Out of scope; this issue is what changes that, but only for
// page.tsx's control, not the edit form). Bound to a specific item id via
// `.bind(null, itemId)` in the client component, same shape
// updateItemAction (lib/actions/items.ts) uses -- its real signature as
// passed to useActionState is (prevState, formData).
//
// Type/size are checked here *before* createClient() is ever called --
// same "cheap local validation before any network round trip" ordering
// createItemAction/updateItemAction already use for their Zod parse -- so a
// rejected file never even reaches the ownership check, let alone storage
// or item_images. Both checks are re-done here even though
// CoverUploadControl pre-checks the same thing client-side: a JS-disabled
// or hand-crafted direct submission (or a spoofed <input accept>) must
// still be rejected the same way. The `covers` bucket's own
// file_size_limit/allowed_mime_types (migration
// 20260909130000_set_covers_bucket_limits.sql) are a second, storage-layer
// line of defense -- never relied on as the only gate.
export async function uploadCoverAction(
  itemId: string,
  _prevState: UploadCoverActionState,
  formData: FormData,
): Promise<UploadCoverActionState> {
  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }

  if (!isAllowedCoverMimeType(file.type)) {
    return { error: COVER_TYPE_ERROR };
  }

  if (file.size > MAX_COVER_SIZE_BYTES) {
    return { error: COVER_SIZE_ERROR };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- proxy.ts already redirects an unauthenticated
    // request to /login before this route/action is ever reachable.
    return { error: "You must be signed in to upload a cover." };
  }

  // Existence + ownership + not-soft-deleted, same explicit
  // .eq("user_id", user.id).is("deleted_at", null) pattern
  // updateItemAction already uses -- never relies on the covers_insert_own/
  // covers_update_own storage policies (which only check the path's user_id
  // segment, not that this item actually exists or belongs to this user)
  // as the only gate. A request naming another user's item id (or a
  // soft-deleted one) resolves to the same plain error as a nonexistent
  // one, before storage or item_images is ever touched.
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

  // Fixed, extension-less path per item (issue #19's Constraints). Uploaded
  // with upsert: true + an explicit contentType set to the just-validated
  // MIME type, so a later replacement overwrites this same storage object
  // in place -- no old file is ever orphaned, and there's no delete-then-
  // insert race against item_images' partial unique index (database-
  // schema.md §3, added by #5) to manage, since the object's path never
  // changes between uploads.
  const storagePath = `${user.id}/${itemId}/cover`;

  const { error: uploadError } = await supabase.storage
    .from("covers")
    .upload(storagePath, file, { upsert: true, contentType: file.type });
  if (uploadError) {
    return { error: "Failed to upload cover image. Please try again." };
  }

  // Check for an existing is_cover=true row first to decide insert vs.
  // update (issue #19's Constraints; the update branch added by #38). On
  // the item's first-ever cover upload, insert one row. On a later
  // replacement, that row's storage_path is already correct (the path
  // never changes) -- only the storage object above changed -- but the row
  // itself must still be written to, not skipped: an UPDATE (even one that
  // writes back the same storage_path) is what fires
  // item_images_set_updated_at (migration 20260910150000), advancing
  // updated_at so the public cover URL's `?v=` cache-busting param
  // (src/lib/queries/items.ts) actually changes on every replace. Before
  // #38, this branch was a no-op -- fine while covers were served via
  // fresh signed URLs on every request, but wrong now that the URL is
  // meant to be cached long-lived. Either branch keeps a replace at
  // exactly one item_images row with is_cover=true, never zero, never two.
  const { data: existingCover } = await supabase
    .from("item_images")
    .select("id")
    .eq("item_id", itemId)
    .eq("is_cover", true)
    .maybeSingle();

  if (existingCover) {
    const { error: updateError } = await supabase
      .from("item_images")
      .update({ storage_path: storagePath })
      .eq("id", existingCover.id);
    if (updateError) {
      return {
        error: "Cover image uploaded, but saving it failed. Please try again.",
      };
    }
  } else {
    const { error: insertError } = await supabase.from("item_images").insert({
      item_id: itemId,
      storage_path: storagePath,
      is_cover: true,
    });
    if (insertError) {
      return {
        error: "Cover image uploaded, but saving it failed. Please try again.",
      };
    }
  }

  // Same "redirect back to the same detail route" pattern updateItemAction
  // uses to force a fresh server re-render -- getItemDetail/getLibraryItems
  // (lib/queries/items.ts) already resolve coverUrl from whichever
  // item_images row has is_cover=true via a public URL carrying that row's
  // updated_at as a `?v=` cache-busting param (issue #38), so the new cover
  // becomes visible on both the detail page and the category Card view
  // automatically, with no other read-side change needed.
  redirect(`/${category.slug}/${itemId}`);
}

// Server Action backing CoverUploadControl.tsx's "Remove cover" button
// (issue #35). Takes only the item id -- unlike uploadCoverAction, there's
// no file/FormData to carry, so this is called directly (via
// startTransition, not a real <form>/useActionState pair), same itemId-arg
// shape as restoreItemAction (lib/actions/trash.ts) and
// removeAttachmentAction (lib/actions/attachments.ts). Instant, no
// confirmation step (#35's own acceptance criteria): a removed cover is
// trivially recoverable by uploading a new one, unlike Trash's permanent
// delete.
//
// Ownership + ordering both mirror established precedent rather than
// inventing a new shape:
// - The `.eq("id", itemId).eq("user_id", user.id).is("deleted_at", null)`
//   existence/ownership check against `items` is copied verbatim from
//   uploadCoverAction above -- never relies on the covers_delete_own
//   storage policy (path-scoped only, doesn't know an item exists or is
//   owned by the caller) as the sole gate.
// - Storage-object-then-item_images-row deletion, in that order, is
//   removeAttachmentAction's exact ordering: if storage.remove() fails,
//   this returns early and the item_images row (still pointing at a real
//   object) is left untouched -- no dangling row claiming a cover exists
//   that isn't there. If storage succeeds but the row delete then fails,
//   a retry self-heals (storage.remove() on an already-removed path is a
//   no-op, not an error).
// - No existing is_cover=true row (already removed, or never had one --
//   e.g. a stale UI state) is a harmless no-op per #35's acceptance
//   criteria: skip straight to the redirect below without touching storage
//   or item_images at all, same "empty is success, not failure" reasoning
//   clearStorageFolder (lib/actions/trash.ts) uses for an empty folder.
export async function removeCoverAction(
  itemId: string,
): Promise<UploadCoverActionState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- proxy.ts already redirects an unauthenticated
    // request to /login before this action is ever reachable.
    return { error: "You must be signed in to remove a cover." };
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

  const { data: existingCover } = await supabase
    .from("item_images")
    .select("id, storage_path")
    .eq("item_id", itemId)
    .eq("is_cover", true)
    .maybeSingle();

  if (existingCover) {
    const { error: storageError } = await supabase.storage
      .from("covers")
      .remove([existingCover.storage_path]);
    if (storageError) {
      return { error: "Failed to remove cover image. Please try again." };
    }

    const { error: deleteError } = await supabase
      .from("item_images")
      .delete()
      .eq("id", existingCover.id);
    if (deleteError) {
      return { error: "Failed to remove cover image. Please try again." };
    }
  }

  // Same redirect target/purpose as uploadCoverAction's -- forces a fresh
  // server re-render so coverUrl resolves to null, CoverThumbnail falls
  // back to its hidden/no-cover state, and the button reverts to reading
  // "Upload cover", on both the detail page and (next load) Card view.
  redirect(`/${category.slug}/${itemId}`);
}
