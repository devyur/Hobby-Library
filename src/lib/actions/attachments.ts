"use server";

import { createClient } from "@/lib/supabase/server";
import {
  ATTACHMENT_LIMIT_ERROR,
  ATTACHMENT_SIZE_ERROR,
  ATTACHMENT_TYPE_ERROR,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  resolveAttachmentMimeType,
} from "@/lib/validation/attachments";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface AttachmentResult {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string | null;
}

export type UploadAttachmentActionResult = { attachment: AttachmentResult } | { error: string };
export type RemoveAttachmentActionResult = { success: true } | { error: string };

// Same 1-hour convention as COVER_SIGNED_URL_TTL_SECONDS (lib/queries/
// items.ts) -- redefined here rather than imported, since actions and
// queries don't share a constants module for this (same as how
// MAX_COVER_SIZE_BYTES-style constants live per-feature in lib/validation).
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Same ownership/not-found check as getOwnedItem in lib/actions/links.ts,
// reimplemented locally (that module exports no shared helper): a request
// naming another user's item id (or a soft-deleted one) resolves to `null`
// here, exactly like a wholly nonexistent id, never a distinguishable error.
// Never relies on RLS (item_attachments_select_own, etc.) alone.
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

// Uploads one file attachment to one item -- its own immediate Server
// Action call, independent of every other attachment on the item and of
// #16's Edit/Save toggle, matching addLinkAction's shape
// (lib/actions/links.ts). Takes the File directly as an argument (Server
// Actions support File/Blob as serializable arguments) rather than FormData
// -- there's no other field to carry alongside it, unlike
// uploadCoverAction's real <form>/useActionState pair.
//
// Type/size are checked here *before* createClient() is ever called -- same
// "cheap local validation before any network round trip" ordering
// uploadCoverAction already uses -- so a rejected file never even reaches
// the ownership check, let alone storage or item_attachments. Both checks
// are re-done here even though ItemAttachmentsEditor pre-checks the same
// thing client-side: a JS-disabled or hand-crafted direct call must still be
// rejected the same way. The `attachments` bucket's own
// file_size_limit/allowed_mime_types (migration
// 20260909140000_create_attachments_storage_bucket.sql) are a second,
// storage-layer line of defense -- never relied on as the only gate.
export async function uploadAttachmentAction(
  itemId: string,
  file: File,
): Promise<UploadAttachmentActionResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const mimeType = resolveAttachmentMimeType(file.name);
  if (!mimeType) {
    return { error: ATTACHMENT_TYPE_ERROR };
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return { error: ATTACHMENT_SIZE_ERROR };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- proxy.ts already redirects an unauthenticated
    // request to /login before this action is ever reachable.
    return { error: "You must be signed in to manage attachments." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  // Per-item cap (issue #21's Constraints): counted, not schema-enforced.
  // Checked before any storage/DB write -- an 11th attempt never touches
  // either.
  const { count } = await supabase
    .from("item_attachments")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId);
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_ITEM) {
    return { error: ATTACHMENT_LIMIT_ERROR };
  }

  // Id-keyed path (issue #21's Constraints): generated up front so the
  // Storage object and its item_attachments row share the same id, and so
  // same-named files never collide -- no filename sanitization needed for
  // the storage key, unlike `covers`' fixed extension-less path (which only
  // ever holds one object per item).
  const attachmentId = crypto.randomUUID();
  const storagePath = `${user.id}/${itemId}/${attachmentId}`;

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(storagePath, file, { contentType: mimeType });
  if (uploadError) {
    return { error: "Failed to upload attachment. Please try again." };
  }

  const { data: row, error: insertError } = await supabase
    .from("item_attachments")
    .insert({
      id: attachmentId,
      item_id: itemId,
      storage_path: storagePath,
      filename: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
    })
    .select("id, filename, mime_type, size_bytes")
    .single();

  if (insertError || !row) {
    // The row write failed after a successful storage upload -- clean up
    // the now-orphaned object rather than leaving a Storage object with no
    // item_attachments row pointing to it (same "nothing orphaned in either
    // place" bar this issue sets for removal, applied to upload failure
    // too).
    await supabase.storage.from("attachments").remove([storagePath]);
    return { error: "Attachment uploaded, but saving it failed. Please try again." };
  }

  // Resolved eagerly so the just-uploaded attachment can render a working
  // download control immediately, without a page reload -- same reasoning
  // as getItemDetail resolving every attachment's downloadUrl up front.
  const { data: signed } = await supabase.storage
    .from("attachments")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: row.filename });

  return {
    attachment: {
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      downloadUrl: signed?.signedUrl ?? null,
    },
  };
}

// Removes one attachment from one item -- its own immediate Server Action
// call, independent of every other attachment on the item and of #16's
// Edit/Save toggle, matching removeLinkAction's shape. Deletes the Storage
// object first, then the item_attachments row: if the storage delete fails,
// nothing else happens and the row (still pointing at a real object) is
// left exactly as it was, so the user can just retry. If the storage delete
// succeeds but the row delete then fails, the row is retried the same
// way on the next attempt -- storage.remove() on an already-removed path is
// a no-op, not an error -- so this self-heals rather than ever leaving a row
// that points at a missing object.
export async function removeAttachmentAction(
  itemId: string,
  attachmentId: string,
): Promise<RemoveAttachmentActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to manage attachments." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { data: attachment } = await supabase
    .from("item_attachments")
    .select("id, storage_path")
    .eq("item_id", itemId)
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment) {
    return { error: "This attachment could not be found." };
  }

  const { error: storageError } = await supabase.storage
    .from("attachments")
    .remove([attachment.storage_path]);
  if (storageError) {
    return { error: "Failed to remove attachment. Please try again." };
  }

  const { error: deleteError } = await supabase
    .from("item_attachments")
    .delete()
    .eq("item_id", itemId)
    .eq("id", attachmentId);
  if (deleteError) {
    return { error: "Failed to remove attachment. Please try again." };
  }

  return { success: true };
}
