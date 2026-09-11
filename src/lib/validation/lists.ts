import { z } from "zod";

// Shared Zod schema for list name input (issue #26) -- both Create and
// Rename on lists/page.tsx use it, same client pre-check + server re-check
// role as tagNameSchema (lib/validation/tags.ts)/itemLinkSchema
// (lib/validation/links.ts). `.trim()` means a whitespace-only name is
// rejected, not silently trimmed down to an accepted empty string (the
// issue's own acceptance criteria for both Create and Rename). No
// uniqueness check here -- `lists.name` has no unique constraint
// (database-schema.md §3) and the issue explicitly doesn't add one.
export const listNameSchema = z.object({
  name: z.string().trim().min(1, "Enter a list name"),
});

export type ListNameInput = z.infer<typeof listNameSchema>;

// Reorder payload (issue #42) -- reorderListItemsAction's own input schema.
// The client sends the *entire* new item-id order for the list as one array
// (one Server Action call per drop, never one call per row/frame, per the
// issue's own constraints), so the only shape worth validating here is
// "at least one id, and no duplicates" -- a malformed/empty array is
// rejected before ever reaching getOwnedList or the database. The set/
// membership check against the list's actual current members happens in
// the action itself (lib/actions/lists.ts), not here, since that requires a
// database read this schema has no access to.
export const reorderListItemsSchema = z.object({
  itemIds: z
    .array(z.string().trim().min(1))
    .min(1, "A reorder needs at least one item")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Duplicate item ids in reorder payload",
    }),
});

export type ReorderListItemsInput = z.infer<typeof reorderListItemsSchema>;
