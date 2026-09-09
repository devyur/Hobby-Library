import { z } from "zod";

// Shared Zod schema for the Full Add form (issue #14), used both
// client-side (blocking submission before any network call, matching the
// pattern in RegisterForm.tsx) and inside the Server Action in
// lib/actions/items.ts as the server-side re-check -- a request that skips
// the client (JS disabled, a direct POST/invoke) still can't create an
// invalid row.
//
// Minimum valid item (plan.md §3): title + category + subtype + status.
// Rating/priority/tags/notes/review are all optional. Cover image, links,
// and attachments are out of scope (#19/#20/#21) and have no fields here.

const itemStatusValues = ["planned", "ongoing", "completed", "dropped"] as const;
const priorityLevelValues = ["low", "medium", "high"] as const;

// Empty string -> undefined for optional fields coming out of a plain HTML
// form/FormData, where "not filled in" is "" rather than absent.
function emptyToUndefined(value: unknown): unknown {
  return value === "" || value === null || value === undefined ? undefined : value;
}

// null/undefined -> "" for required fields. FormData omits disabled form
// controls entirely (formData.get returns null, not "") -- the Subtype
// select is disabled until a category is chosen, so submitting with no
// category also submits with *no subtypeId key at all*, not an empty one.
// Normalizing to "" here means that case still fails the same
// `min(1, "...is required")` check (and message) as every other
// not-filled-in required field, rather than a generic "expected string,
// received null" zod error.
function nullToEmptyString(value: unknown): unknown {
  return value === null || value === undefined ? "" : value;
}

export const addItemSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),

  // .uuid() (not just non-empty) so a select emptied/tampered to a
  // non-uuid value fails validation here, before ever reaching the
  // subtype/category cross-check in the Server Action.
  categoryId: z.preprocess(
    nullToEmptyString,
    z.string().trim().min(1, "Category is required").uuid("Select a valid category"),
  ),
  subtypeId: z.preprocess(
    nullToEmptyString,
    z.string().trim().min(1, "Subtype is required").uuid("Select a valid subtype"),
  ),

  status: z.enum(itemStatusValues, { message: "Status is required" }),

  // Matches the items_rating_check constraint (1-10 inclusive) so an
  // out-of-range value is rejected here, client-side, before any database
  // round trip -- not left for the DB constraint to reject.
  rating: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ message: "Rating must be a number" })
      .int("Rating must be a whole number")
      .min(1, "Rating must be between 1 and 10")
      .max(10, "Rating must be between 1 and 10")
      .optional(),
  ),

  priority: z.preprocess(emptyToUndefined, z.enum(priorityLevelValues).optional()),

  // Checkbox-group multi-select: FormData.getAll("tagIds") is always an
  // array (possibly empty), never absent.
  tagIds: z.array(z.string().uuid()).optional().default([]),

  notes: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  review: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

export type AddItemInput = z.infer<typeof addItemSchema>;

// Quick Add form (issue #15): title + category only. status ('planned')
// and subtype_id (the category's predefined "Other" row) are both resolved
// server-side in the Server Action, never taken from the client -- so
// neither field appears here, unlike addItemSchema above.
export const quickAddItemSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),

  categoryId: z.preprocess(
    nullToEmptyString,
    z.string().trim().min(1, "Category is required").uuid("Select a valid category"),
  ),
});

export type QuickAddItemInput = z.infer<typeof quickAddItemSchema>;

// Edit item form (issue #16): status/rating/priority/notes/review only --
// title/category/subtype are permanently out of scope for editing (see the
// issue's Out of scope section), so this schema has no fields for them at
// all, unlike addItemSchema above. Reuses the same itemStatusValues/
// priorityLevelValues/emptyToUndefined preprocessing this module already
// defines for addItemSchema, rather than duplicating them.
export const editItemSchema = z.object({
  status: z.enum(itemStatusValues, { message: "Status is required" }),

  rating: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ message: "Rating must be a number" })
      .int("Rating must be a whole number")
      .min(1, "Rating must be between 1 and 10")
      .max(10, "Rating must be between 1 and 10")
      .optional(),
  ),

  priority: z.preprocess(emptyToUndefined, z.enum(priorityLevelValues).optional()),

  notes: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  review: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

export type EditItemInput = z.infer<typeof editItemSchema>;

// Shared result shape for the Add Item Server Action, consumed via
// useActionState in AddItemForm.tsx -- same shape as AuthFormState in
// lib/validation/auth.ts (formError for a page-level message, fieldErrors
// keyed by field name for inline errors), kept as its own type here rather
// than imported from auth.ts since the two forms are otherwise unrelated.
export type ItemFormState = {
  formError: string | null;
  fieldErrors: Record<string, string>;
};

export const initialItemFormState: ItemFormState = {
  formError: null,
  fieldErrors: {},
};
