import { z } from "zod";

import { subtypeNameSchema } from "@/lib/validation/subtypes";
import { tagNameSchema } from "@/lib/validation/tags";

// Full-file structural schema for Import (issue #30), mirroring #29's
// *actual* live shape (src/lib/queries/export.ts's ExportData/ExportItem/
// ExportList interfaces) field-for-field -- that code, not the #29 issue
// text, is the authoritative source of truth for what a real export file
// contains. Subtype/tag name rules are reused, not reimplemented, per the
// issue's own constraint: subtypeNameSchema/tagNameSchema are the same
// trimmed-non-empty schemas createSubtypeAction/addTagToItemAction
// themselves re-check with, so an import name that would be rejected by
// those actions is caught here first, with the same message.
//
// Matching/insert logic (the DB-touching half) lives in
// lib/actions/import.ts -- this module only ever validates the parsed
// object in memory, never calls createClient() or touches the network.

const itemStatusValues = ["planned", "ongoing", "completed", "dropped"] as const;
const priorityLevelValues = ["low", "medium", "high"] as const;

const importSubtypeSchema = z.object({
  // Reuses subtypeNameSchema's own trimmed-non-empty `name` field rule
  // (issue #30's Constraints) rather than a parallel min(1) check here.
  name: subtypeNameSchema.shape.name,
  // Read for round-trip fidelity only -- never used to decide match-vs-
  // create (lib/actions/import.ts never reads this field at all).
  is_custom: z.boolean(),
});

const importTagSchema = z.object({
  name: tagNameSchema.shape.name,
  is_custom: z.boolean(),
});

const importLinkSchema = z.object({
  // No strict URL-format check, matching #20's own lack of one (issue #30
  // AC) -- just a non-empty string.
  url: z.string().min(1, "Link URL is required"),
  label: z.string().nullable(),
});

// images[]/attachments[] are validated for shape only -- their contents are
// never used for anything beyond confirming the key is array-shaped (issue
// #30 AC). No item_images/item_attachments row is ever created from these;
// see importItem's handling in lib/actions/import.ts.
const importImageSchema = z.object({
  storage_path: z.string(),
  is_cover: z.boolean(),
  sort_order: z.number(),
  created_at: z.string(),
});

const importAttachmentSchema = z.object({
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  created_at: z.string(),
});

const importItemSchema = z.object({
  // The file's own id -- never written into a real items.id (issue #30 AC);
  // only ever used locally to build the item-id -> new-item-id map for
  // resolving lists[].item_ids.
  id: z.string().min(1, "Item id is required"),
  // Same min(1) rule as addItemSchema's own `title` field (issue #30 AC).
  title: z.string().trim().min(1, "Title is required"),
  category: z.string().trim().min(1, "Category is required"),
  subtype: importSubtypeSchema,
  status: z.enum(itemStatusValues, { message: "Unrecognized status value" }),
  priority: z.enum(priorityLevelValues, { message: "Unrecognized priority value" }).nullable(),
  // Matches the items_rating_check constraint (1-10 inclusive).
  rating: z.number().int().min(1).max(10).nullable(),
  notes: z.string().nullable(),
  review: z.string().nullable(),
  created_at: z.string().min(1, "created_at is required"),
  updated_at: z.string().min(1, "updated_at is required"),
  completed_at: z.string().nullable(),
  tags: z.array(importTagSchema),
  links: z.array(importLinkSchema),
  images: z.array(importImageSchema),
  attachments: z.array(importAttachmentSchema),
});

const importListSchema = z.object({
  name: z.string().trim().min(1, "List name is required"),
  created_at: z.string().min(1, "created_at is required"),
  item_ids: z.array(z.string().min(1)),
});

// schema_version is intentionally typed loosely here (checked explicitly,
// separately, in checkSchemaVersion below) rather than z.literal(1) alone --
// so an absent/string/future-2 value fails with the dedicated "Unsupported
// export file version" message instead of a generic Zod literal-mismatch
// error.
export const importFileSchema = z.object({
  schema_version: z.unknown(),
  exported_at: z.string(),
  items: z.array(importItemSchema),
  lists: z.array(importListSchema),
});

export type ImportItem = z.infer<typeof importItemSchema>;
export type ImportList = z.infer<typeof importListSchema>;
export type ImportFile = z.infer<typeof importFileSchema>;

// schema_version handling is structured as an explicit switch (issue #30's
// Constraints) so a future format bump has an obvious place to add a second
// `case` -- not a single hardcoded `=== 1` check with no room to extend. `1`
// is the only version this issue defines; anything else (absent, a string,
// a future 2, ...) is the explicit `default` branch.
export function checkSchemaVersion(value: unknown): { ok: true } | { ok: false; error: string } {
  switch (value) {
    case 1:
      return { ok: true };
    default:
      return { ok: false, error: "Unsupported export file version." };
  }
}

export type ValidateImportFileResult = { ok: true; data: ImportFile } | { ok: false; error: string };

// Two of #30's three validation layers happen here, entirely in memory,
// before lib/actions/import.ts ever calls createClient():
//   1. structural -- the Zod schema above, plus the explicit schema_version
//      check.
//   2. the one referential-shaped check that doesn't need the database: a
//      lists[].item_ids entry must match some items[].id present elsewhere
//      in the same file (issue #30 AC) -- a dangling reference fails the
//      whole file the same way any other malformed shape does.
// The one referential check that *does* need the database -- category slugs
// against the real categories table -- stays in lib/actions/import.ts,
// which is the only place with a Supabase client.
export function validateImportFile(parsed: unknown): ValidateImportFileResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "This file isn't a valid Hobby Library export." };
  }

  const versionCheck = checkSchemaVersion((parsed as { schema_version?: unknown }).schema_version);
  if (!versionCheck.ok) {
    return { ok: false, error: versionCheck.error };
  }

  const structural = importFileSchema.safeParse(parsed);
  if (!structural.success) {
    const issue = structural.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "file";
    return { ok: false, error: `${path}: ${issue?.message ?? "This file isn't a valid export."}` };
  }

  const knownItemIds = new Set(structural.data.items.map((item) => item.id));
  for (const list of structural.data.lists) {
    for (const itemId of list.item_ids) {
      if (!knownItemIds.has(itemId)) {
        return {
          ok: false,
          error: `lists.${list.name}.item_ids: references an item id not present in this file.`,
        };
      }
    }
  }

  return { ok: true, data: structural.data };
}

// Result shape for importLibraryAction, consumed via useActionState in
// ImportLibraryForm.tsx -- lives here (not lib/actions/import.ts) for the
// same reason ItemFormState lives in lib/validation/items.ts rather than
// lib/actions/items.ts: a "use server" file can only export async
// functions.
//
// `result` stays `null` for any validation failure (malformed JSON, schema
// mismatch, schema_version mismatch, unrecognized category, dangling list
// reference) -- guaranteeing the UI never shows a partial-success state when
// nothing was written (issue #30 AC). Once writing has begun, `result` is
// always set (even on a mid-write DB failure) with `partial: true` in that
// case, and `error` alongside it explaining what stopped -- visibly
// distinct from the zero-writes case, which has `result: null`.
export type ImportActionState = {
  error: string | null;
  result: { itemsImported: number; listsImported: number; partial: boolean } | null;
};

export const initialImportActionState: ImportActionState = { error: null, result: null };
