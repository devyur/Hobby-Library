"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { quickAddItemAction } from "@/lib/actions/items";
import type { CategorySummary } from "@/lib/queries/categories";
import { initialItemFormState, quickAddItemSchema } from "@/lib/validation/items";

// Quick Add form (issue #15): exactly two inputs -- Title and Category --
// no subtype/status/rating/priority/tags/notes/review. Same
// useActionState + client-side Zod pre-check + inline-field-error pattern
// as AddItemForm.tsx/RegisterForm.tsx: a client-side rejection blocks the
// network call, and quickAddItemAction re-validates with the identical
// schema so a request that skips this component (JS disabled, a direct
// POST) is rejected the same way.
//
// status ('planned') and subtype_id (the category's "Other" row) are never
// asked for here -- both are resolved entirely server-side in
// quickAddItemAction, so there is nothing for a tampered submission to
// override.
export function QuickAddForm({
  categories,
  initialCategoryId,
}: {
  categories: CategorySummary[];
  initialCategoryId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    quickAddItemAction,
    initialItemFormState,
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = quickAddItemSchema.safeParse({
      title: formData.get("title"),
      categoryId: formData.get("categoryId"),
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
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Quick add</h1>
        <p className="text-sm text-text-secondary">
          Drop something into your backlog. It&rsquo;s added as Planned --
          edit the rest later.
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
            autoFocus
            aria-invalid={!!fieldErrors.title}
            aria-describedby={fieldErrors.title ? "title-error" : undefined}
          />
          {fieldErrors.title ? (
            <p id="title-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <Select
            id="categoryId"
            name="categoryId"
            defaultValue={initialCategoryId}
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

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Adding…" : "Add"}
          </Button>
          <Link href="/dashboard" className="text-sm text-text-secondary hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
