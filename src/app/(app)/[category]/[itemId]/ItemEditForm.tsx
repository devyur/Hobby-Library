"use client";

import { useActionState, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ItemTagsEditor, type TagOption } from "@/components/items/ItemTagsEditor";
import { NotesReview } from "@/components/items/NotesReview";
import { PriorityBadge } from "@/components/items/PriorityBadge";
import { RatingBadge } from "@/components/items/RatingBadge";
import { StatusPill } from "@/components/items/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { updateItemAction } from "@/lib/actions/items";
import type { Database } from "@/lib/supabase/types";
import { editItemSchema, initialItemFormState } from "@/lib/validation/items";

type ItemStatus = Database["public"]["Enums"]["item_status"];
type PriorityLevel = Database["public"]["Enums"]["priority_level"];

// Same STATUS_OPTIONS/PRIORITY_OPTIONS label sets as AddItemForm.tsx (#14)
// -- duplicated rather than imported since AddItemForm doesn't export them
// either (same non-DRY precedent zodFieldErrors/ItemFormState already set
// in lib/actions/items.ts and lib/validation/items.ts).
const STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

// Edit item (issue #16). Owns the view/edit toggle in place on the item
// detail page -- no dedicated /edit route, no modal (none of
// src/components/ui/ has a Dialog primitive, same finding #15's grooming
// already made). Cover/links/attachments/title/category-subtype-label stay
// in page.tsx, rendered unchanged regardless of this component's mode;
// Added/Completed dates and Tags are rendered here (unchanged in both view
// and edit mode) since they sit visually alongside the fields this issue
// does make editable.
//
// Pre-edit rating/review/status are needed at submit time to compute the
// nudge's before/after diff -- passed down as props from the Server
// Component (getItemDetail's own read), never re-fetched client-side.
export function ItemEditForm({
  itemId,
  status,
  rating,
  priority,
  notes,
  review,
  createdAt,
  completedAt,
  tags: initialTags,
  tagSuggestions,
}: {
  itemId: string;
  status: ItemStatus;
  rating: number | null;
  priority: PriorityLevel | null;
  notes: string | null;
  review: string | null;
  createdAt: string;
  completedAt: string | null;
  tags: TagOption[];
  tagSuggestions: TagOption[];
}) {
  const boundUpdateItemAction = updateItemAction.bind(null, itemId);
  const [state, formAction, isPending] = useActionState(
    boundUpdateItemAction,
    initialItemFormState,
  );
  const [isEditing, setIsEditing] = useState(false);
  // Owned here, not inside ItemTagsEditor -- see that component's own
  // comment: the view/edit toggle below remounts it on every switch, so its
  // attached-tags list has to survive in a parent that doesn't unmount.
  const [tags, setTags] = useState<TagOption[]>(initialTags);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [showNudge, setShowNudge] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Set right before a programmatic requestSubmit() triggered by one of the
  // nudge's own buttons, so handleSubmit's re-run on that resubmission
  // doesn't re-evaluate the nudge condition and loop back into itself.
  const skipNudgeCheckRef = useRef(false);

  function handleEdit() {
    setIsEditing(true);
    setClientErrors({});
    setShowNudge(false);
  }

  function handleCancel() {
    setIsEditing(false);
    setClientErrors({});
    setShowNudge(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = editItemSchema.safeParse({
      status: formData.get("status"),
      rating: formData.get("rating"),
      priority: formData.get("priority"),
      notes: formData.get("notes"),
      review: formData.get("review"),
    });

    if (!parsed.success) {
      event.preventDefault();
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
      }
      setClientErrors(errors);
      return;
    }
    setClientErrors({});

    if (skipNudgeCheckRef.current) {
      skipNudgeCheckRef.current = false;
      return;
    }

    // Nudge trigger (plan.md §4): rating or review going from empty to
    // filled on *this* save, and the status about to be submitted isn't
    // already Completed. Re-editing an item that already has a
    // rating/review (only changing priority, or 6 -> 8) never triggers
    // this -- both checks compare against the pre-edit props, not against
    // "is the new value non-empty".
    const ratingNewlyFilled = rating === null && parsed.data.rating !== undefined;
    const reviewNewlyFilled =
      (!review || review.trim() === "") &&
      parsed.data.review !== undefined &&
      parsed.data.review.trim() !== "";
    const targetStatus = parsed.data.status;

    if ((ratingNewlyFilled || reviewNewlyFilled) && targetStatus !== "completed") {
      event.preventDefault();
      setShowNudge(true);
    }
  }

  // Backs both nudge buttons. "Mark Completed & Save" forces the Status
  // select to "completed" first; "Just save" (targetStatus = null) submits
  // with status left exactly as the user set it -- either way every other
  // changed field (rating, review, notes, priority) is submitted too, since
  // this resubmits the same form, not a stripped-down one.
  function submitWithStatus(targetStatus: ItemStatus | null) {
    const form = formRef.current;
    if (!form) return;
    if (targetStatus) {
      const statusSelect = form.elements.namedItem("status") as HTMLSelectElement | null;
      if (statusSelect) statusSelect.value = targetStatus;
    }
    skipNudgeCheckRef.current = true;
    setShowNudge(false);
    form.requestSubmit();
  }

  const fieldErrors = { ...state.fieldErrors, ...clientErrors };

  function renderDatesAndTags() {
    return (
      <div className="flex flex-col gap-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-secondary">
          <div className="flex gap-1">
            <dt className="font-medium text-text-primary">Added:</dt>
            <dd>{formatDate(createdAt)}</dd>
          </div>
          {completedAt ? (
            <div className="flex gap-1">
              <dt className="font-medium text-text-primary">Completed:</dt>
              <dd>{formatDate(completedAt)}</dd>
            </div>
          ) : null}
        </dl>

        {/* Always interactive, independent of isEditing (issue #17) --
            rendered by this same renderDatesAndTags() call in both the view
            and edit branches below, so it's never gated behind #16's
            Edit/Save toggle. */}
        <ItemTagsEditor
          itemId={itemId}
          tags={tags}
          onTagsChange={setTags}
          suggestionPool={tagSuggestions}
        />
      </div>
    );
  }

  if (!isEditing) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            <RatingBadge rating={rating} />
            <PriorityBadge status={status} priority={priority} />
            <Button type="button" variant="outline" size="sm" onClick={handleEdit}>
              Edit
            </Button>
          </div>
          {renderDatesAndTags()}
        </div>

        <NotesReview notes={notes} review={review} />
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      {state.formError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.formError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Select
            id="status"
            name="status"
            defaultValue={status}
            aria-invalid={!!fieldErrors.status}
            aria-describedby={fieldErrors.status ? "status-error" : undefined}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {fieldErrors.status ? (
            <p id="status-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.status}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rating">Rating (1–10)</Label>
          <Input
            id="rating"
            name="rating"
            type="number"
            min={1}
            max={10}
            step={1}
            inputMode="numeric"
            defaultValue={rating ?? ""}
            aria-invalid={!!fieldErrors.rating}
            aria-describedby={fieldErrors.rating ? "rating-error" : undefined}
          />
          {fieldErrors.rating ? (
            <p id="rating-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.rating}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select
            id="priority"
            name="priority"
            defaultValue={priority ?? ""}
            aria-invalid={!!fieldErrors.priority}
            aria-describedby={fieldErrors.priority ? "priority-error" : undefined}
          >
            <option value="">None</option>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {fieldErrors.priority ? (
            <p id="priority-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.priority}
            </p>
          ) : null}
        </div>
      </div>

      {renderDatesAndTags()}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={notes ?? ""} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review">Review</Label>
        <Textarea id="review" name="review" rows={4} defaultValue={review ?? ""} />
      </div>

      {showNudge ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
          <p className="text-sm text-text-primary">
            Sounds like you&apos;re done with this one — mark it Completed?
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => submitWithStatus("completed")}>
              Mark Completed & Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => submitWithStatus(null)}
            >
              Just save
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
