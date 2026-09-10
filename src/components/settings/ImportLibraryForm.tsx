"use client";

import { useActionState, useId, useRef } from "react";
import type { ChangeEvent } from "react";

import { importLibraryAction } from "@/lib/actions/import";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { initialImportActionState } from "@/lib/validation/import";

// Import library form (issue #30) -- the first client component in a new
// src/components/settings/ domain folder, same precedent as items/
// dashboard/lists/nav each starting as a new folder when their owning
// feature landed. A real <form>/useActionState pair like
// CoverUploadControl.tsx (#19), not ItemAttachmentsEditor.tsx's plain
// useTransition + direct-call shape: importLibraryAction needs a real
// FormData carrying the actual File the browser picked, which only a real
// form submission can do (a file input's value can't be set
// programmatically).
//
// Selecting a file auto-submits (via requestSubmit()) -- there's nothing
// else to fill in first, same UX as CoverUploadControl/
// ItemAttachmentsEditor.
export function ImportLibraryForm() {
  const [state, formAction, isPending] = useActionState(
    importLibraryAction,
    initialImportActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const resultId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    formRef.current?.requestSubmit();
  }

  return (
    <div className="flex flex-col gap-2">
      <form ref={formRef} action={formAction}>
        <Label htmlFor={inputId} className="sr-only">
          Export file
        </Label>
        <input
          ref={inputRef}
          id={inputId}
          name="file"
          type="file"
          accept="application/json,.json"
          onChange={handleChange}
          disabled={isPending}
          aria-invalid={!!state.error}
          aria-describedby={state.error ? errorId : state.result ? resultId : undefined}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? "Importing…" : "Import"}
        </Button>
      </form>

      {state.error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      {state.result ? (
        <div id={resultId} className="flex flex-col gap-1 text-sm">
          {state.result.partial ? (
            <p className="text-text-primary">
              Import stopped partway through: {state.result.itemsImported} item
              {state.result.itemsImported === 1 ? "" : "s"} and {state.result.listsImported} list
              {state.result.listsImported === 1 ? "" : "s"} were created before the error above
              occurred. Those rows were not removed -- check your library before importing again.
            </p>
          ) : (
            <p className="text-text-primary">
              Imported {state.result.itemsImported} item
              {state.result.itemsImported === 1 ? "" : "s"} and {state.result.listsImported} list
              {state.result.listsImported === 1 ? "" : "s"}.
            </p>
          )}
          <p className="text-text-secondary">
            Cover images and attachments are not restored by import -- re-add them manually on
            each item if you want them back. Importing the same file again creates a second,
            duplicate set of items and lists; there is no de-duplication.
          </p>
        </div>
      ) : null}
    </div>
  );
}
