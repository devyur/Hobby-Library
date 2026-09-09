"use client";

import { useId, useRef, useState, useTransition } from "react";
import type { ChangeEvent } from "react";

import { removeAttachmentAction, uploadAttachmentAction } from "@/lib/actions/attachments";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatFileSize } from "@/lib/format";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMIT_ERROR,
  ATTACHMENT_SIZE_ERROR,
  ATTACHMENT_TYPE_ERROR,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  isAllowedAttachmentExtension,
  getFileExtension,
} from "@/lib/validation/attachments";

export interface AttachmentOption {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string | null;
}

// Always-interactive Attachments section for the item detail page (issue
// #21), replacing the read-only ItemAttachments.tsx (#13). Same
// ItemLinksEditor (#20) precedent: never gated behind ItemEditForm's (#16)
// isEditing state, so a user can upload/download/remove an attachment
// without first clicking "Edit," and doing so never touches or requires
// saving status/rating/priority/notes/review.
//
// Rendered directly by page.tsx, not inside ItemEditForm -- like
// ItemLinksEditor, it never gets unmounted/remounted by that component's
// view vs. edit toggle, so it can safely own its `attachments` list as
// local state, seeded once from the server-rendered `initialAttachments`
// prop.
//
// File selection auto-submits (via the onChange handler below) rather than
// requiring a separate "Upload" click, same UX as CoverUploadControl
// (#19) -- there's nothing else to fill in first. Unlike
// CoverUploadControl, this doesn't need a real <form>/useActionState pair:
// uploadAttachmentAction takes the File directly as a plain argument (no
// other field travels with it), so a useTransition + direct-call shape like
// ItemLinksEditor's works here too.
export function ItemAttachmentsEditor({
  itemId,
  initialAttachments,
}: {
  itemId: string;
  initialAttachments: AttachmentOption[];
}) {
  const [attachments, setAttachments] = useState<AttachmentOption[]>(initialAttachments);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  const atLimit = attachments.length >= MAX_ATTACHMENTS_PER_ITEM;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    // Client-side pre-check, mirroring the server-side re-check in
    // uploadAttachmentAction -- a disallowed extension or oversized file
    // never even attempts the Server Action call. Same UX-only role as
    // ItemLinksEditor's pre-check; the server is the real, only-relied-upon
    // gate.
    const extension = getFileExtension(file.name);
    if (!isAllowedAttachmentExtension(extension)) {
      setError(ATTACHMENT_TYPE_ERROR);
      input.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      setError(ATTACHMENT_SIZE_ERROR);
      input.value = "";
      return;
    }

    setError(null);
    input.value = ""; // allow re-selecting the same filename later

    startTransition(async () => {
      const result = await uploadAttachmentAction(itemId, file);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // New attachment is inserted with the newest created_at -- appending
      // keeps the list in insertion order without a re-fetch, same as
      // ItemLinksEditor.
      setAttachments((current) => [...current, result.attachment]);
    });
  }

  function handleRemove(attachment: AttachmentOption) {
    setError(null);
    const previous = attachments;
    // Optimistic removal -- its own independent action, doesn't touch or
    // wait on any other attachment, matching ItemLinksEditor.handleRemove.
    setAttachments((current) => current.filter((a) => a.id !== attachment.id));

    startTransition(async () => {
      const result = await removeAttachmentAction(itemId, attachment.id);
      if ("error" in result) {
        setAttachments(previous);
        setError(result.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-primary">Attachments</h2>

      {attachments.length === 0 ? (
        <p className="text-sm text-text-secondary">No attachments yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center gap-2 text-sm text-text-primary"
            >
              <span>{attachment.filename}</span>
              <span className="text-text-secondary">
                {formatFileSize(attachment.sizeBytes)} · {attachment.mimeType}
              </span>
              {attachment.downloadUrl ? (
                <a
                  href={attachment.downloadUrl}
                  className="text-sm text-accent hover:underline"
                >
                  Download
                </a>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${attachment.filename}`}
                onClick={() => handleRemove(attachment)}
                disabled={isPending}
                className="rounded-full text-text-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId} className="sr-only">
          Attachment file
        </Label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          onChange={handleChange}
          disabled={isPending || atLimit}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="hidden"
        />
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || atLimit}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? "Uploading…" : "Add attachment"}
          </Button>
        </div>
        {atLimit ? (
          <p className="text-sm text-text-secondary">{ATTACHMENT_LIMIT_ERROR}</p>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
