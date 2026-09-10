// Client-side cover resize/compress (issue #37), called from
// CoverUploadControl.tsx's handleChange before the file reaches
// uploadCoverAction (lib/actions/covers.ts). Browser-native only (Canvas /
// OffscreenCanvas + createImageBitmap) -- no new npm dependency, per the
// issue's Constraints.
//
// Always re-encodes to WebP (never JPEG, never lossless PNG): WebP is the
// one output format that handles both an opaque JPEG-style source and a
// PNG source with an alpha channel without flattening transparency, and
// it's already an allowed type end-to-end (ALLOWED_COVER_MIME_TYPES in
// lib/validation/covers.ts, the `covers` bucket's own allowed_mime_types).
// Never upscales -- a source already at or under MAX_DIMENSION on its long
// edge keeps its original pixel dimensions, only its encoding changes.
//
// Any failure (decode failure, a null blob from toBlob/convertToBlob, an
// unsupported API) is caught here and resolves to the original File
// unchanged rather than throwing -- the caller uploads that original file
// as-is, still gated by the existing 5MB/MIME pre-check it already passed.
// A console.warn records the failure for diagnosis; there's nothing
// actionable for the user to do differently, so no error is surfaced to them.

const MAX_DIMENSION = 800;
const WEBP_QUALITY = 0.8;

export async function resizeCoverImage(file: File): Promise<File> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);

    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const blob = await drawAndEncode(bitmap, width, height);
    if (!blob) {
      console.warn("resizeCoverImage: no blob produced, uploading the original file instead");
      return file;
    }

    return new File([blob], withWebpExtension(file.name), { type: "image/webp" });
  } catch (error) {
    console.warn("resizeCoverImage: resize failed, uploading the original file instead", error);
    return file;
  } finally {
    bitmap?.close();
  }
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob | null> {
  // OffscreenCanvas first (issue #37 names both as acceptable) -- falls
  // back to a plain <canvas> element for the rare browser that has
  // createImageBitmap but not OffscreenCanvas.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/webp", WEBP_QUALITY);
  });
}

function withWebpExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.webp`;
}
