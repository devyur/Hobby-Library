import { z } from "zod";

// Shared Zod schema for the item detail page's Links section (issue #20),
// same client pre-check + server re-check role as tagNameSchema
// (lib/validation/tags.ts). `url` follows that file's min(1)-style
// empty/whitespace-only rejection, plus a scheme check: it must parse as a
// well-formed absolute URL (via the WHATWG URL constructor) with protocol
// `http:` or `https:` -- a plain domain with no scheme ("imdb.com") fails to
// parse as absolute at all, and a non-http(s) scheme ("javascript:",
// "ftp://", "mailto:") parses but is rejected on the protocol check. `label`
// is optional free text; a blank/whitespace-only label is normalized to
// `null` here so it's stored absent, matching item_links.label's nullable
// column (same as a link added with no label at all).
export const itemLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Enter a URL")
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, "Enter a valid URL starting with http:// or https://"),
  label: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null)),
});

export type ItemLinkInput = z.infer<typeof itemLinkSchema>;
