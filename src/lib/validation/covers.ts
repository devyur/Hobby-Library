// Shared cover-image upload constants (issue #19), used both client-side
// (CoverUploadControl.tsx's pre-submit check and its <input accept> hint)
// and server-side (uploadCoverAction in lib/actions/covers.ts, the actual
// enforcement point -- the client check is a UX nicety only, same
// client-pre-check + server-re-check split every other form in this project
// already follows).
//
// Matches what CoverThumbnail.tsx already renders via a plain <img> (no
// SVG, no animated GIF -- see issue #19's Constraints) and the
// file_size_limit/allowed_mime_types set on the `covers` bucket itself by
// migration 20260909130000_set_covers_bucket_limits.sql -- kept in sync by
// hand, not derived from one another (no runtime path reads the bucket
// config back out).

export const ALLOWED_COVER_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedCoverMimeType = (typeof ALLOWED_COVER_MIME_TYPES)[number];

export function isAllowedCoverMimeType(type: string): type is AllowedCoverMimeType {
  return (ALLOWED_COVER_MIME_TYPES as readonly string[]).includes(type);
}

export const MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const COVER_TYPE_ERROR = "Cover images must be JPG, PNG, or WEBP.";
export const COVER_SIZE_ERROR = "Cover images must be 5 MB or smaller.";

// Shared result shape for uploadCoverAction (lib/actions/covers.ts), consumed
// via useActionState in CoverUploadControl.tsx -- kept here rather than in
// the "use server" actions file itself, since a file marked "use server" may
// only export async functions (a plain object export like
// initialUploadCoverState breaks that at build time) -- same reason
// ItemFormState/initialItemFormState live in lib/validation/items.ts rather
// than lib/actions/items.ts.
export type UploadCoverActionState = { error: string | null };

export const initialUploadCoverState: UploadCoverActionState = { error: null };
