"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import type { ChangeEvent } from "react";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { removeCoverAction, uploadCoverAction } from "@/lib/actions/covers";
import { resizeCoverImage } from "@/lib/images/resizeCoverImage";
import {
  COVER_SIZE_ERROR,
  COVER_TYPE_ERROR,
  MAX_COVER_SIZE_BYTES,
  initialUploadCoverState,
  isAllowedCoverMimeType,
} from "@/lib/validation/covers";

// Cover upload control (issue #19) -- wraps the read-only CoverThumbnail
// (#12) with an upload/replace affordance, attached at the item detail
// page's CoverThumbnail spot (src/app/(app)/[category]/[itemId]/page.tsx)
// rather than inside ItemEditForm.tsx: that file's own header comment says
// cover stays "never editable" per #16's Out of scope -- this issue is what
// finally changes that, but only here, not there. A "Remove cover" button
// (issue #35) sits alongside Replace, shown only when the item currently
// has a cover -- instant on click, no confirmation step, since a removed
// cover is trivially recoverable by re-uploading (unlike Trash's permanent
// delete, which does confirm).
//
// Same client-pre-check + server-re-check split every other form in this
// project already follows: the immediate type/size check in handleChange is
// a UX nicety only (an instant inline error with no round trip for the
// common mistake), never the actual gate -- uploadCoverAction
// (lib/actions/covers.ts) re-checks both server-side, which is what a
// JS-disabled or hand-crafted submission still has to pass.
//
// A file input's value can't be set programmatically (browser security
// restriction), so this needs a real <form>/useActionState pair (like
// ItemEditForm.tsx) rather than ItemTagsEditor.tsx's plain useTransition +
// direct-call pattern -- FormData has to carry the actual File object the
// browser picked, and only a real form submission can do that. Selecting a
// file auto-submits (via requestSubmit()) rather than requiring a separate
// "Upload" click -- there's nothing else to fill in first.
export function CoverUploadControl({
  itemId,
  coverUrl,
  title,
}: {
  itemId: string;
  coverUrl: string | null;
  title: string;
}) {
  const boundUploadCoverAction = uploadCoverAction.bind(null, itemId);
  const [state, formAction, isPending] = useActionState(
    boundUploadCoverAction,
    initialUploadCoverState,
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  // Remove cover (issue #35) -- no FormData to carry (just the item id
  // already in scope), so this is a plain useTransition + direct-call pair
  // like ItemTagsEditor.tsx, not a second <form>/useActionState. On success
  // removeCoverAction redirects server-side (throws, navigates away), so
  // this callback only ever resumes on the error path.
  const [isRemoving, startRemoveTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleRemove() {
    setClientError(null);
    setRemoveError(null);
    startRemoveTransition(async () => {
      const result = await removeCoverAction(itemId);
      if (result.error) {
        setRemoveError(result.error);
      }
    });
  }

  const busy = isPending || isRemoving;

  // Resizing (issue #37) is async, but the input/form this reads from are
  // real DOM nodes captured up front (`input`), not React's SyntheticEvent
  // itself -- safe to keep using after the `await`. On success the resized
  // File replaces the input's FileList via a DataTransfer (a file input's
  // `.files` can't be assigned a plain array/File directly) *before*
  // requestSubmit(), so uploadCoverAction's `formData.get("cover")` read
  // side never has to know resizing happened. If resizeCoverImage's own
  // try/catch can't produce a resized file, it already resolves to the
  // original `file` unchanged (logged via console.warn) -- that's the
  // fallback path from #37's acceptance criteria, and it needs no special
  // handling here since `resized === file` just skips the DataTransfer swap
  // and submits the original, already pre-checked above.
  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!isAllowedCoverMimeType(file.type)) {
      setClientError(COVER_TYPE_ERROR);
      input.value = "";
      return;
    }
    if (file.size > MAX_COVER_SIZE_BYTES) {
      setClientError(COVER_SIZE_ERROR);
      input.value = "";
      return;
    }

    setClientError(null);

    const resized = await resizeCoverImage(file);
    if (resized !== file) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(resized);
      input.files = dataTransfer.files;
    }

    formRef.current?.requestSubmit();
  }

  // A rejected client-side check takes priority (it's about the file the
  // user just picked, more relevant than a stale server error from a
  // previous attempt); state.error/removeError are what's left once a
  // submission actually reached the server -- either action's error can
  // occupy this same slot, since only one can ever be in flight at once
  // (`busy` disables both buttons while the other is pending).
  const error = clientError ?? state.error ?? removeError;

  return (
    <div className="flex flex-col gap-2">
      {/* hideWhenEmpty: no tall empty placeholder box here when there's no
          cover yet -- see CoverThumbnail's own header comment. */}
      <CoverThumbnail coverUrl={coverUrl} title={title} hideWhenEmpty />

      <div className="flex flex-wrap items-center gap-2">
        <form ref={formRef} action={formAction}>
          <Label htmlFor={inputId} className="sr-only">
            Cover image
          </Label>
          <input
            ref={inputRef}
            id={inputId}
            name="cover"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleChange}
            disabled={busy}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? "Uploading…" : coverUrl ? "Replace cover" : "Upload cover"}
          </Button>
        </form>

        {/* Shown only when the item currently has a cover -- there's
            nothing to remove otherwise, same condition Replace vs. Upload's
            label already switches on. */}
        {coverUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={handleRemove}
          >
            {isRemoving ? "Removing…" : "Remove cover"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
