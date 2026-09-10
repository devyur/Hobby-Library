"use client";

import { useActionState, useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uploadCoverAction } from "@/lib/actions/covers";
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
// finally changes that, but only here, not there. Removing a cover entirely
// is out of scope (filed as #35) -- there is deliberately no "remove"
// control, only upload/replace.
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

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isAllowedCoverMimeType(file.type)) {
      setClientError(COVER_TYPE_ERROR);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_COVER_SIZE_BYTES) {
      setClientError(COVER_SIZE_ERROR);
      event.target.value = "";
      return;
    }

    setClientError(null);
    formRef.current?.requestSubmit();
  }

  // A rejected client-side check takes priority (it's about the file the
  // user just picked, more relevant than a stale server error from a
  // previous attempt); state.error is what's left once a submission
  // actually reached the server.
  const error = clientError ?? state.error;

  return (
    <div className="flex flex-col gap-2">
      {/* hideWhenEmpty: no tall empty placeholder box here when there's no
          cover yet -- see CoverThumbnail's own header comment. */}
      <CoverThumbnail coverUrl={coverUrl} title={title} hideWhenEmpty />

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
          disabled={isPending}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? "Uploading…" : coverUrl ? "Replace cover" : "Upload cover"}
        </Button>
      </form>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
