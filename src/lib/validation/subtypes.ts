import { z } from "zod";

// Shared Zod schema for the "create a new subtype" free-text input (issue
// #18), used both client-side (SubtypePicker.tsx, blocking submission before
// any network call) and inside createSubtypeAction
// (lib/actions/subtypes.ts) as the server-side re-check -- same shape as
// tagNameSchema (lib/validation/tags.ts), kept as its own schema per the
// issue's own constraint ("rather than overloading tagNameSchema") since
// subtypes and tags are otherwise unrelated tables with independent
// create-a-new-one flows.
export const subtypeNameSchema = z.object({
  name: z.string().trim().min(1, "Enter a subtype name"),
});

export type SubtypeNameInput = z.infer<typeof subtypeNameSchema>;
