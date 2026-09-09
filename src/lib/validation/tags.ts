import { z } from "zod";

// Shared Zod schema for the typed-name path of the item detail page's Tags
// section (issue #17) -- attaching an *existing* suggestion by id needs no
// schema (its id already came from a trusted server-returned suggestion
// list), but the "create or attach by name" path takes free-text input, so
// it gets the same client pre-check + server re-check treatment as
// lib/validation/items.ts's form schemas: `.trim()` so leading/trailing
// whitespace is ignored for the empty/whitespace-only rejection, matching
// the issue's "matching compares trimmed names" requirement.
export const tagNameSchema = z.object({
  name: z.string().trim().min(1, "Enter a tag name"),
});

export type TagNameInput = z.infer<typeof tagNameSchema>;
