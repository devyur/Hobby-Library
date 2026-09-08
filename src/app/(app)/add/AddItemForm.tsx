"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createItemAction } from "@/lib/actions/items";
import type { CategorySummary } from "@/lib/queries/categories";
import type { SubtypeOption } from "@/lib/queries/subtypes";
import type { TagOption } from "@/lib/queries/tags";
import { addItemSchema, initialItemFormState } from "@/lib/validation/items";

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

// Full Add form (issue #14). Client-side Zod pre-check blocks an obviously
// invalid submission before any network call -- same useActionState +
// pre-check pattern as RegisterForm.tsx -- and the Server Action
// (createItemAction) re-validates with the identical schema, so a request
// that skips this component entirely (JS disabled, a direct POST) is still
// rejected the same way.
//
// categoryId/subtypeId are the only controlled fields: Category drives which
// Subtype options are shown (AC: only the selected category's subtypes),
// and changing Category clears whatever Subtype was selected for the
// previous one (AC: no stale cross-category subtype survives a category
// change). Every other field is left uncontrolled -- plain FormData reads
// in both the client pre-check and the Server Action.
export function AddItemForm({
  categories,
  subtypes,
  tags,
}: {
  categories: CategorySummary[];
  subtypes: SubtypeOption[];
  tags: TagOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    createItemAction,
    initialItemFormState,
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [categoryId, setCategoryId] = useState("");
  const [subtypeId, setSubtypeId] = useState("");

  const availableSubtypes = subtypes.filter(
    (subtype) => subtype.categoryId === categoryId,
  );

  function handleCategoryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setCategoryId(event.target.value);
    setSubtypeId("");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = addItemSchema.safeParse({
      title: formData.get("title"),
      categoryId: formData.get("categoryId"),
      subtypeId: formData.get("subtypeId"),
      status: formData.get("status"),
      rating: formData.get("rating"),
      priority: formData.get("priority"),
      tagIds: formData.getAll("tagIds"),
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
  }

  const fieldErrors = { ...state.fieldErrors, ...clientErrors };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Add item</h1>
        <p className="text-sm text-text-secondary">
          Add something new to your library.
        </p>
      </div>

      <form
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            aria-invalid={!!fieldErrors.title}
            aria-describedby={fieldErrors.title ? "title-error" : undefined}
          />
          {fieldErrors.title ? (
            <p id="title-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="categoryId">Category</Label>
            <Select
              id="categoryId"
              name="categoryId"
              value={categoryId}
              onChange={handleCategoryChange}
              aria-invalid={!!fieldErrors.categoryId}
              aria-describedby={fieldErrors.categoryId ? "category-error" : undefined}
            >
              <option value="">Select a category…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            {fieldErrors.categoryId ? (
              <p id="category-error" className="text-sm text-red-600 dark:text-red-400">
                {fieldErrors.categoryId}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subtypeId">Subtype</Label>
            <Select
              id="subtypeId"
              name="subtypeId"
              value={subtypeId}
              onChange={(event) => setSubtypeId(event.target.value)}
              disabled={!categoryId}
              aria-invalid={!!fieldErrors.subtypeId}
              aria-describedby={fieldErrors.subtypeId ? "subtype-error" : undefined}
            >
              <option value="">
                {categoryId ? "Select a subtype…" : "Select a category first"}
              </option>
              {availableSubtypes.map((subtype) => (
                <option key={subtype.id} value={subtype.id}>
                  {subtype.name}
                </option>
              ))}
            </Select>
            {fieldErrors.subtypeId ? (
              <p id="subtype-error" className="text-sm text-red-600 dark:text-red-400">
                {fieldErrors.subtypeId}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <Select
              id="status"
              name="status"
              defaultValue="planned"
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
              defaultValue=""
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

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text-primary">Tags</legend>
          {tags.length === 0 ? (
            <p className="text-sm text-text-secondary">No tags available yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-2 text-sm text-text-primary"
                >
                  <Checkbox name="tagIds" value={tag.id} />
                  {tag.name}
                </label>
              ))}
            </div>
          )}
          {fieldErrors.tagIds ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.tagIds}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={3} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review">Review</Label>
          <Textarea id="review" name="review" rows={4} />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Adding…" : "Add item"}
          </Button>
          <Link href="/dashboard" className="text-sm text-text-secondary hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
