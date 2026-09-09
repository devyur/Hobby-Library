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
