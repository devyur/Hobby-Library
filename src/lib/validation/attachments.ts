// Shared file-attachment upload constants (issue #21), used both
// client-side (ItemAttachmentsEditor.tsx's pre-submit check and its
// <input accept> hint) and server-side (uploadAttachmentAction in
// lib/actions/attachments.ts, the actual enforcement point) -- same
// client-pre-check + server-re-check split lib/validation/covers.ts already
// follows for cover images.
//
// Validation is extension-based, not MIME-type-based: the browser-supplied
// File.type is unreliable, especially for .md (no universally registered
// browser/OS MIME type -- commonly arrives empty or as
// "application/octet-stream"). The server derives a canonical MIME type
// from the validated extension instead of trusting File.type, and that
// derived value is what's used for both the Storage upload's contentType
// and the item_attachments.mime_type column. Kept in sync by hand with the
// `attachments` bucket's own allowed_mime_types (migration
// 20260909140000_create_attachments_storage_bucket.sql) -- no runtime path
// reads the bucket config back out, same convention lib/validation/covers.ts
// documents for `covers`.

export const ALLOWED_ATTACHMENT_EXTENSIONS = ["txt", "md", "pdf"] as const;

export type AllowedAttachmentExtension = (typeof ALLOWED_ATTACHMENT_EXTENSIONS)[number];

const EXTENSION_TO_MIME_TYPE: Record<AllowedAttachmentExtension, string> = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
};

// Lowercased, no leading dot -- "" for a filename with no extension at all
// (e.g. "README" or a filename ending in a bare "."). Case-insensitive per
// the issue's Constraints ("Allowed extensions ... case-insensitive").
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function isAllowedAttachmentExtension(
  extension: string,
): extension is AllowedAttachmentExtension {
  return (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension);
}

// Derives the canonical MIME type from a filename's extension, or null if
// the extension isn't one of the allowed three. Server-side, this is the
// only source of truth used for both the Storage contentType and
// item_attachments.mime_type -- File.type is never read.
export function resolveAttachmentMimeType(filename: string): string | null {
  const extension = getFileExtension(filename);
  return isAllowedAttachmentExtension(extension) ? EXTENSION_TO_MIME_TYPE[extension] : null;
}

export const MAX_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB -- smaller than covers' 5 MB cap; these are meant to be small reference documents.

// Enforced in uploadAttachmentAction (no schema-level constraint) by
// counting existing item_attachments rows for the item before insert.
export const MAX_ATTACHMENTS_PER_ITEM = 10;

export const ATTACHMENT_TYPE_ERROR = "Attachments must be a .txt, .md, or .pdf file.";
export const ATTACHMENT_SIZE_ERROR = "Attachments must be 2 MB or smaller.";
export const ATTACHMENT_LIMIT_ERROR =
  "This item already has 10 attachments, the maximum allowed.";

// <input accept> hint -- a UX nicety only (narrows the OS file picker), not
// a security boundary; the extension check above is what's actually relied
// on client-side, and uploadAttachmentAction re-checks server-side
// regardless.
export const ATTACHMENT_ACCEPT = ".txt,.md,.pdf";
