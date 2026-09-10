"use client";

import { createContext, useActionState, useContext, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ItemTagsEditor, type TagOption } from "@/components/items/ItemTagsEditor";
import { NotesReview } from "@/components/items/NotesReview";
import { PriorityBadge } from "@/components/items/PriorityBadge";
import { RatingBadge } from "@/components/items/RatingBadge";
import { StatusPill } from "@/components/items/StatusPill";
import { SubtypePicker, type SubtypeChoice } from "@/components/items/SubtypePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateOnly } from "@/lib/format";
import { deleteItemAction, updateItemAction } from "@/lib/actions/items";
import type { Database } from "@/lib/supabase/types";
import {
  editItemSchema,
  initialDeleteItemActionState,
  initialItemFormState,
} from "@/lib/validation/items";

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

// Edit item (issue #16; Subtype editing added in #18). Owns the view/edit
// toggle in place on the item detail page -- no dedicated /edit route, no
// modal (none of src/components/ui/ has a Dialog primitive, same finding
// #15's grooming already made). Cover/links/attachments/title stay in
// page.tsx, rendered unchanged regardless of this component's mode; the
// category·subtype label there also stays unchanged (category itself is
// still not editable -- #18 only makes subtype editable, scoped to the
// item's existing category -- and that label reflects the last-saved
// subtype name, refreshed like every other field via updateItemAction's own
// redirect back to this same route). Added date and Tags are rendered here
// (unchanged in both view and edit mode) since they sit visually alongside
// the fields this issue does make editable; the read-only "Completed:" row
// in view mode is likewise unchanged, but edit mode gained its own editable
// Completed date field in #34 (see the completedAt input further down).
//
// Pre-edit rating/review/status are needed at submit time to compute the
// nudge's before/after diff -- passed down as props from the Server
// Component (getItemDetail's own read), never re-fetched client-side.
//
// categoryId/subtypeId/subtypeOptions (issue #18): categoryId is the item's
// fixed, unchanged category (never itself editable here -- passed through
// only so SubtypePicker/createSubtypeAction know which category to scope a
// new subtype to); subtypeOptions is that category's subtypes (predefined +
// the user's own), pre-filtered server-side by page.tsx the same way
// AddItemForm.tsx filters client-side, since there's only ever one category
// to filter to here. subtypeId is kept as controlled state at this
// component's top level (like `tags` below), not inside the edit-mode
// branch, so it survives the view/edit remount instead of resetting -- and
// handleCancel explicitly reverts it, since a controlled value (unlike the
// uncontrolled status/rating/priority/notes/review inputs) wouldn't
// otherwise revert to the pre-edit selection when re-entering edit mode.
//
// Follow-up layout change (after 6ef579d's two-column page.tsx): the
// human user asked for Status/Rating/actions/Added-date/Tags to sit in the
// LEFT column (with Cover/Links/Attachments) while Notes/Review sit alone
// in the RIGHT column. Since all of that used to be one unified render tree
// owned by a single component instance, and page.tsx needs to place the two
// halves in two physically separate DOM locations while still sharing one
// isEditing/tags/etc. state, this file is split three ways instead of one:
//   - `ItemEditFormProvider` owns every bit of state/handler logic this
//     component always had (100% unchanged), and exposes it via context.
//     It renders no DOM of its own -- just passes `children` through -- so
//     wrapping page.tsx's whole two-column grid in it has no layout effect.
//   - `ItemEditFormPrimary` (rendered in page.tsx's left column) renders the
//     status/rating/priority badges + Edit/Delete + delete-confirm + Added/
//     Completed dates + Tags in view mode -- and, when isEditing is true,
//     the *entire* edit-mode form (status/rating/priority/subtype inputs,
//     dates+tags, notes/review textareas, save/cancel/nudge), unchanged
//     from before. Edit mode isn't part of this layout request, so it isn't
//     split across columns -- it still renders as the one unified block it
//     always was, just now from within the left-column consumer.
//   - `ItemEditFormNotesReview` (rendered in page.tsx's right column) shows
//     the read-only Notes/Review view when not editing, and renders nothing
//     while editing (its fields are part of the single form already
//     rendered by ItemEditFormPrimary above).
type ItemEditFormContextValue = {
  notes: string | null;
  review: string | null;
  isEditing: boolean;
  status: ItemStatus;
  rating: number | null;
  priority: PriorityLevel | null;
  categoryId: string;
  completedAt: string | null;
  subtypeId: string;
  setSubtypeId: (subtypeId: string) => void;
  subtypeOptions: SubtypeChoice[];
  handleSubtypeCreated: (subtype: SubtypeChoice) => void;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (value: boolean) => void;
  deleteState: { error?: string | null };
  deleteFormAction: (payload: FormData) => void;
  isDeleting: boolean;
  handleEdit: () => void;
  handleCancel: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitWithStatus: (targetStatus: ItemStatus | null) => void;
  formRef: React.RefObject<HTMLFormElement | null>;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  formError?: string | null;
  fieldErrors: Record<string, string>;
  showNudge: boolean;
  renderDatesAndTags: () => ReactNode;
};

const ItemEditFormContext = createContext<ItemEditFormContextValue | null>(null);

function useItemEditFormContext(componentName: string): ItemEditFormContextValue {
  const ctx = useContext(ItemEditFormContext);
  if (!ctx) {
    throw new Error(`${componentName} must be rendered inside an ItemEditFormProvider`);
  }
  return ctx;
}

export function ItemEditFormProvider({
  children,
  itemId,
  status,
  rating,
  priority,
  notes,
  review,
  createdAt,
  completedAt,
  categoryId,
  subtypeId: initialSubtypeId,
  subtypeOptions: initialSubtypeOptions,
  tags: initialTags,
  tagSuggestions,
}: {
  children: ReactNode;
  itemId: string;
  status: ItemStatus;
  rating: number | null;
  priority: PriorityLevel | null;
  notes: string | null;
  review: string | null;
  createdAt: string;
  completedAt: string | null;
  categoryId: string;
  subtypeId: string;
  subtypeOptions: SubtypeChoice[];
  tags: TagOption[];
  tagSuggestions: TagOption[];
}) {
  const boundUpdateItemAction = updateItemAction.bind(null, itemId);
  const [state, formAction, isPending] = useActionState(
    boundUpdateItemAction,
    initialItemFormState,
  );
  const [isEditing, setIsEditing] = useState(false);
  // Delete (issue #25) -- its own useActionState/form pair, independent of
  // the update form above, same redirect-on-success convention
  // updateItemAction already uses. showDeleteConfirm gates an inline
  // "Delete this item? Confirm / Cancel" panel (no Dialog primitive exists,
  // per the issue's Constraints -- same showNudge pattern this component
  // already uses below) -- a single click on Delete never deletes
  // immediately.
  const boundDeleteItemAction = deleteItemAction.bind(null, itemId);
  const [deleteState, deleteFormAction, isDeleting] = useActionState(
    boundDeleteItemAction,
    initialDeleteItemActionState,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Owned here, not inside ItemTagsEditor -- see that component's own
  // comment: the view/edit toggle below remounts it on every switch, so its
  // attached-tags list has to survive in a parent that doesn't unmount.
  const [tags, setTags] = useState<TagOption[]>(initialTags);
  // Same "owned at the top level, not inside the edit-mode branch" reasoning
  // as `tags` -- see this component's own header comment.
  const [subtypeId, setSubtypeId] = useState(initialSubtypeId);
  const [subtypeOptions, setSubtypeOptions] = useState<SubtypeChoice[]>(
    initialSubtypeOptions,
  );
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
    // Revert to the pre-edit selection -- subtypeId is controlled state that
    // survives the isEditing toggle (unlike the uncontrolled status/rating/
    // priority/notes/review inputs, which simply remount with their
    // defaultValue), so Cancel must explicitly discard an in-progress
    // subtype change here. A subtype created via SubtypePicker during this
    // edit is left in place either way (its own immediate DB write, not part
    // of this form's submission) -- only the item's own subtype_id selection
    // is discarded.
    setSubtypeId(initialSubtypeId);
  }

  function handleSubtypeCreated(subtype: SubtypeChoice) {
    // createSubtypeAction is create-or-find -- a "created" callback can also
    // fire for a dedup match against an already-known row, so this only
    // appends when the id isn't already present, mirroring
    // ItemTagsEditor.tsx's own `addTagLocally` guard.
    setSubtypeOptions((current) =>
      current.some((option) => option.id === subtype.id) ? current : [...current, subtype],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = editItemSchema.safeParse({
      status: formData.get("status"),
      subtypeId: formData.get("subtypeId"),
      rating: formData.get("rating"),
      priority: formData.get("priority"),
      notes: formData.get("notes"),
      review: formData.get("review"),
      completedAt: formData.get("completedAt"),
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
              <dd>{formatDateOnly(completedAt)}</dd>
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

  const value: ItemEditFormContextValue = {
    notes,
    review,
    isEditing,
    status,
    rating,
    priority,
    categoryId,
    completedAt,
    subtypeId,
    setSubtypeId,
    subtypeOptions,
    handleSubtypeCreated,
    showDeleteConfirm,
    setShowDeleteConfirm,
    deleteState,
    deleteFormAction,
    isDeleting,
    handleEdit,
    handleCancel,
    handleSubmit,
    submitWithStatus,
    formRef,
    formAction,
    isPending,
    formError: state.formError,
    fieldErrors,
    showNudge,
    renderDatesAndTags,
  };

  return <ItemEditFormContext.Provider value={value}>{children}</ItemEditFormContext.Provider>;
}

// Left column: status/rating/priority badges, Edit/Delete, Added/Completed
// dates, Tags -- and, when isEditing, the entire edit form (unsplit; see
// this file's header comment for why edit mode isn't divided across
// columns).
export function ItemEditFormPrimary() {
  const {
    isEditing,
    status,
    rating,
    priority,
    handleEdit,
    showDeleteConfirm,
    setShowDeleteConfirm,
    deleteState,
    deleteFormAction,
    isDeleting,
    renderDatesAndTags,
    categoryId,
    completedAt,
    subtypeId,
    setSubtypeId,
    subtypeOptions,
    handleSubtypeCreated,
    notes,
    review,
    fieldErrors,
    formRef,
    formAction,
    handleSubmit,
    formError,
    showNudge,
    submitWithStatus,
    handleCancel,
    isPending,
  } = useItemEditFormContext("ItemEditFormPrimary");

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
            {/* Delete (issue #25) -- view mode only, matching how Edit
                itself is scoped: never rendered while isEditing. */}
            {!showDeleteConfirm ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </Button>
            ) : null}
          </div>
          {renderDatesAndTags()}
        </div>

        {showDeleteConfirm ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
            <p className="text-sm text-text-primary">Delete this item?</p>
            {deleteState.error ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {deleteState.error}
              </p>
            ) : null}
            <form action={deleteFormAction} className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isDeleting}>
                {isDeleting ? "Deleting…" : "Confirm"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
            </form>
          </div>
        ) : null}
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
      {formError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {formError}
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subtypeId">Subtype</Label>
        <SubtypePicker
          id="subtypeId"
          categoryId={categoryId}
          value={subtypeId}
          options={subtypeOptions}
          onChange={setSubtypeId}
          onCreated={handleSubtypeCreated}
          ariaInvalid={!!fieldErrors.subtypeId}
          ariaDescribedBy={fieldErrors.subtypeId ? "subtype-error" : undefined}
        />
        {fieldErrors.subtypeId ? (
          <p id="subtype-error" className="text-sm text-red-600 dark:text-red-400">
            {fieldErrors.subtypeId}
          </p>
        ) : null}
      </div>

      {/* Manually set/edit completed_at (issue #34). Always shown, not
          gated to status = Completed -- a user can record a completion
          date before marking an item Completed, or leave one in place
          while changing status away from it (plan.md §4: "set manually,
          never inferred automatically"). Pre-filled from the completedAt
          prop's first 10 chars (its YYYY-MM-DD portion) since completed_at
          is always written as UTC midnight for a calendar date -- see
          updateItemAction's own comment on that convention -- so slicing
          is timezone-safe, matching getDashboardData()'s
          row.completed_at.slice(0, 7). Left empty clears completed_at to
          null on save (editItemSchema's emptyToUndefined + updateItemAction's
          `?? null`), same explicit-null pattern rating/priority/notes/review
          already use. Deliberately NOT read by the #16 nudge's
          submitWithStatus -- that only forces the Status select and
          resubmits this same form, so whatever the user already typed here
          (or left blank) rides along unchanged. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="completedAt">Completed date</Label>
        <Input
          id="completedAt"
          name="completedAt"
          type="date"
          defaultValue={completedAt ? completedAt.slice(0, 10) : ""}
          aria-invalid={!!fieldErrors.completedAt}
          aria-describedby={fieldErrors.completedAt ? "completedAt-error" : undefined}
        />
        {fieldErrors.completedAt ? (
          <p id="completedAt-error" className="text-sm text-red-600 dark:text-red-400">
            {fieldErrors.completedAt}
          </p>
        ) : null}
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

// Right column: Notes/Review view only. Renders nothing while isEditing --
// the Notes/Review textareas are part of the single edit form rendered by
// ItemEditFormPrimary above.
export function ItemEditFormNotesReview() {
  const { isEditing, notes, review } = useItemEditFormContext("ItemEditFormNotesReview");
  if (isEditing) {
    return null;
  }
  return <NotesReview notes={notes} review={review} />;
}
