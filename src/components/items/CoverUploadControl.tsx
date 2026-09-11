"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent } from "react";

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

  // Shared pre-check/resize/submit logic (issue #47), extracted out of what
  // used to be handleChange's own inline body so a new clipboard-paste path
  // can drive the exact same pipeline a picked file already went through --
  // no second, parallel validation/resize/upload path. Takes a bare
  // File/Blob rather than a ChangeEvent so it isn't tied to the file input:
  // handleChange (the input's onChange) calls it with input.files[0], and
  // handlePaste (below) calls it with whatever image getAsFile() produced.
  //
  // Resizing (issue #37) is async, but formRef/inputRef this reads from are
  // real DOM nodes captured up front via useRef, not a SyntheticEvent itself
  // -- safe to keep using after the `await`. Either way the (possibly
  // resized) File is written into the hidden input's FileList via a
  // DataTransfer (a file input's `.files` can't be assigned a plain File
  // directly, and a pasted file was never in that FileList to begin with)
  // *before* requestSubmit(), so uploadCoverAction's `formData.get("cover")`
  // read side never has to know whether the file came from the picker or
  // clipboard, or whether resizing happened. If resizeCoverImage's own
  // try/catch can't produce a resized file, it already resolves to the
  // original `file` unchanged (logged via console.warn) -- that's the
  // fallback path from #37's acceptance criteria, and it needs no special
  // handling here, since assigning `resized` back onto the input is correct
  // whether or not it's actually a new File.
  async function submitFile(file: File) {
    if (!isAllowedCoverMimeType(file.type)) {
      setClientError(COVER_TYPE_ERROR);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_COVER_SIZE_BYTES) {
      setClientError(COVER_SIZE_ERROR);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setClientError(null);

    const resized = await resizeCoverImage(file);

    const input = inputRef.current;
    if (input) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(resized);
      input.files = dataTransfer.files;
    }

    formRef.current?.requestSubmit();
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void submitFile(file);
  }

  // Clipboard paste (issue #47) -- a new input path into the same
  // submitFile pipeline above, not a second upload flow. Listens on a
  // wrapper div (below) rather than window/document: that div carries
  // tabIndex so a click anywhere in the control focuses it (a `paste` event
  // only fires on the focused element, or an ancestor it bubbles to), which
  // keeps the listener scoped to this control's lifetime for free -- no
  // window-level listener to attach/detach in an effect, and no risk of
  // hijacking a paste meant for some other input elsewhere on the page.
  //
  // Non-image content (plain text, a non-image file, an empty clipboard) is
  // a deliberate, silent no-op per this issue's acceptance criteria: no
  // clientError is set, nothing is submitted, and the event's default
  // behavior (e.g. pasting text into a focused text field) is left alone by
  // simply not calling preventDefault() on that path.
  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (busy) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    let imageFile: File | null = null;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageFile = file;
          break;
        }
      }
    }
    if (!imageFile) return;

    event.preventDefault();
    void submitFile(imageFile);
  }

  // A rejected client-side check takes priority (it's about the file the
  // user just picked, more relevant than a stale server error from a
  // previous attempt); state.error/removeError are what's left once a
  // submission actually reached the server -- either action's error can
  // occupy this same slot, since only one can ever be in flight at once
  // (`busy` disables both buttons while the other is pending).
  const error = clientError ?? state.error ?? removeError;

  return (
    // tabIndex + onPaste (issue #47) makes this whole control a paste zone:
    // clicking anywhere in it (the thumbnail, the buttons, the empty space
    // around them) focuses this div, and a `paste` event fired on it or any
    // focused descendant (e.g. the "Upload/Replace cover" button itself)
    // bubbles up to this handler. See handlePaste's own comment above for
    // why this scoping was chosen over a window/document-level listener.
    <div
      className="flex flex-col gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-accent/50"
      role="group"
      tabIndex={0}
      onPaste={handlePaste}
      aria-label="Cover image. Click here, then press Ctrl+V to paste an image from your clipboard."
    >
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
            title="You can also paste an image here (Ctrl+V)."
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

      {/* Visible paste affordance (issue #47) -- the title="…" on the
          Upload/Replace button above covers the hover case, but this stays
          on-screen without hovering so the feature isn't hidden. */}
      <p className="text-sm text-text-secondary">Tip: click here, then press Ctrl+V to paste an image.</p>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
