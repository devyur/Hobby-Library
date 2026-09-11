"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  markItemCompletedAction,
  updateNotesAction,
  updateReviewAction,
} from "@/lib/actions/items";

// Notes and Review, each independently always-interactive (issue #48 --
// mirrors how Tags already works, ItemTagsEditor.tsx/#17: its own Server
// Action, its own immediate save, never gated behind ItemEditFormPrimary's
// isEditing toggle). Previously (#13) this file was a read-only renderer
// that returned null for an unset field and null entirely when both were
// unset; it's now two small editors (NotesField/ReviewField below) that
// each render an inviting "Add a note"/"Add a review" button when empty --
// a real focusable control that expands into an inline textarea, not a
// click-anywhere-on-blank-space affordance -- and, once populated, keep the
// same visually-distinct treatment the old renderer used (Notes: --surface
// card with a left accent bar; Review: a bordered --bg block, larger
// italicized text), now with an "Edit note"/"Edit review" button alongside
// since there's no other way back into the textarea -- distinctly named
// (not just "Edit") so each is unambiguous from the main Edit/Save form's
// own "Edit" button, which can be visible on the page at the same time.
//
// Unlike ItemTagsEditor, this component's state does NOT need to be lifted
// into ItemEditFormProvider: the isEditing guard that used to unmount/
// remount ItemEditFormNotesReview (`if (isEditing) return null`) is gone as
// of this same issue, so this component is mounted once and never
// remounted by the main form's own edit toggle -- local state here is safe.
//
// Review also owns its own half of the #16 "suggest marking Completed"
// nudge (plan.md §4) -- see updateReviewAction's own comment in
// lib/actions/items.ts for why that check had to move server-side and
// become check-after-save instead of the rating nudge's block-before-save.
// Notes never triggers any nudge.
export function NotesReview({
  itemId,
  notes,
  review,
}: {
  itemId: string;
  notes: string | null;
  review: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <NotesField itemId={itemId} initialValue={notes} />
      <ReviewField itemId={itemId} initialValue={review} />
    </div>
  );
}

// Shared display treatment per field -- kept exactly as the old read-only
// renderer's classNames so a populated field is visually unchanged from
// before this issue.
const NOTES_DISPLAY_CLASS =
  "whitespace-pre-wrap rounded-md border-l-4 border-l-accent bg-surface p-4 text-sm text-text-primary";
const REVIEW_DISPLAY_CLASS =
  "whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-base italic leading-relaxed text-text-primary";

function NotesField({
  itemId,
  initialValue,
}: {
  itemId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue);
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const headingId = useId();
  const textareaId = useId();
  const errorId = useId();

  function startEdit() {
    setDraft(value ?? "");
    setError(null);
    setIsExpanded(true);
  }

  function handleCancel() {
    setDraft(value ?? "");
    setError(null);
    setIsExpanded(false);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateNotesAction(itemId, draft);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setValue(result.notes);
        setIsExpanded(false);
      } catch {
        // A thrown (not returned) failure -- e.g. a transient session-refresh
        // hiccup on the Server Action round trip -- must still resolve this
        // transition and leave the field editable with a retryable error,
        // rather than leaving Save disabled/"Saving…" forever. The textarea
        // keeps the user's typed draft either way.
        setError("Failed to save notes. Please try again.");
      }
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-medium text-text-primary">
          Notes
        </h2>
        {!isExpanded ? (
          <Button type="button" variant="outline" size="sm" onClick={startEdit}>
            {value ? "Edit note" : "Add a note"}
          </Button>
        ) : null}
      </div>

      {!isExpanded && value ? <div className={NOTES_DISPLAY_CLASS}>{value}</div> : null}

      {isExpanded ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={textareaId} className="sr-only">
            Notes
          </Label>
          <Textarea
            id={textareaId}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isPending}
            aria-labelledby={headingId}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            autoFocus
          />
          <div className="flex items-center gap-3">
            <Button type="button" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isPending}>
              Cancel
            </Button>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ReviewField({
  itemId,
  initialValue,
}: {
  itemId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue);
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Review-triggered nudge (see updateReviewAction's comment in
  // lib/actions/items.ts): independent of the rating-triggered nudge inside
  // ItemEditFormPrimary's own form -- both may be visible at once, no shared
  // state between them.
  const [showNudge, setShowNudge] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [isMarking, startMarkTransition] = useTransition();
  const headingId = useId();
  const textareaId = useId();
  const errorId = useId();

  function startEdit() {
    setDraft(value ?? "");
    setError(null);
    setIsExpanded(true);
  }

  function handleCancel() {
    setDraft(value ?? "");
    setError(null);
    setIsExpanded(false);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateReviewAction(itemId, draft);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setValue(result.review);
        setIsExpanded(false);
        // The save always goes through regardless of the nudge -- this only
        // decides whether the banner appears afterward, per updateReviewAction's
        // check-after-save design.
        if (result.showNudge) {
          setShowNudge(true);
        }
      } catch {
        // Same "thrown, not returned" defensive handling as NotesField's own
        // handleSave -- see that function's comment.
        setError("Failed to save the review. Please try again.");
      }
    });
  }

  function handleMarkCompleted() {
    setMarkError(null);
    startMarkTransition(async () => {
      try {
        const result = await markItemCompletedAction(itemId);
        if ("error" in result) {
          setMarkError(result.error);
          return;
        }
        setShowNudge(false);
      } catch {
        setMarkError("Failed to update status. Please try again.");
      }
    });
  }

  function handleDismiss() {
    setShowNudge(false);
    setMarkError(null);
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-medium text-text-primary">
          Review
        </h2>
        {!isExpanded ? (
          <Button type="button" variant="outline" size="sm" onClick={startEdit}>
            {value ? "Edit review" : "Add a review"}
          </Button>
        ) : null}
      </div>

      {!isExpanded && value ? <div className={REVIEW_DISPLAY_CLASS}>{value}</div> : null}

      {isExpanded ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={textareaId} className="sr-only">
            Review
          </Label>
          <Textarea
            id={textareaId}
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isPending}
            aria-labelledby={headingId}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            autoFocus
          />
          <div className="flex items-center gap-3">
            <Button type="button" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isPending}>
              Cancel
            </Button>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Two buttons, not three (unlike the rating-triggered nudge in
          ItemEditFormPrimary): Review has already saved by the time this
          shows, so there's no pending/unsaved state to discard -- "Cancel"
          doesn't apply, and there's nothing else to "Just save". */}
      {showNudge ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
          <p className="text-sm text-text-primary">
            Sounds like you&apos;re done with this one — mark it Completed?
          </p>
          {markError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {markError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleMarkCompleted} disabled={isMarking}>
              {isMarking ? "Marking…" : "Mark Completed"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDismiss}
              disabled={isMarking}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
