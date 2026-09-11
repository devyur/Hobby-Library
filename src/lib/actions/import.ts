"use server";

import { addTagToItemAction } from "@/lib/actions/tags";
import { createSubtypeAction } from "@/lib/actions/subtypes";
import { createClient } from "@/lib/supabase/server";
import {
  validateImportFile,
  type ImportActionState,
  type ImportItem,
} from "@/lib/validation/import";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Server Action backing ImportLibraryForm.tsx (issue #30). A Server Action,
// not a Route Handler -- import is a file *upload* submitted via
// <form>/FormData (a File from <input type="file">), which Server Actions
// handle natively, unlike #29's export (a download, which is why that one
// *is* a Route Handler -- project-structure.md §1/§4's carve-out is scoped
// to exactly that one case).
//
// Three validation layers run, all before the first write:
//   1. JSON.parse -- a parse failure is rejected with a distinct message,
//      zero writes.
//   2. Structural (validateImportFile, lib/validation/import.ts) -- the
//      full-file Zod schema mirroring #29's live shape, the explicit
//      schema_version check, and the in-file dangling list-reference check.
//      Entirely in memory, no createClient() call yet.
//   3. Referential -- every item's category slug checked against the real
//      categories table, one query covering all four V1 rows. The only
//      validation layer that needs the database, so it's the only one that
//      runs after createClient()/auth.getUser().
//
// Once writing begins (all three layers have passed), true cross-row
// atomicity for the whole file is out of scope for V1 (issue #30's
// Constraints) -- the Supabase JS client issues plain sequential REST calls
// from this Server Action, no multi-table Postgres transaction wrapping
// them. A genuine mid-write database failure stops the loop and reports
// (itemsImported, listsImported, partial: true) rather than rolling back or
// silently continuing -- those already-created rows are not automatically
// removed.
export async function importLibraryAction(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to import.", result: null };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { error: "Failed to read the selected file. Please try again.", result: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "This file isn't valid JSON.", result: null };
  }

  const validation = validateImportFile(parsed);
  if (!validation.ok) {
    return { error: validation.error, result: null };
  }
  const importFile = validation.data;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- proxy.ts already redirects an unauthenticated
    // request to /login before this action is ever reachable.
    return { error: "You must be signed in to import a library.", result: null };
  }

  // Referential validation (layer 3): every item's category slug against
  // the real categories table, one query covering all four V1 rows. An
  // unrecognized slug fails the whole import the same way a structural
  // error does -- never a partial import of just the recognized-category
  // items (issue #30 AC) -- so this still runs entirely before the first
  // insert below.
  const { data: categoryRows } = await supabase.from("categories").select("id, slug");
  const categoryIdBySlug = new Map((categoryRows ?? []).map((row) => [row.slug, row.id]));

  const unrecognized = importFile.items.find((item) => !categoryIdBySlug.has(item.category));
  if (unrecognized) {
    return {
      error: `Unrecognized category "${unrecognized.category}".`,
      result: null,
    };
  }

  // --- Writing begins here. Every return past this point carries a
  // `result`, even on failure, per the issue's "visibly distinct from the
  // zero-writes case" requirement. ---

  let itemsImported = 0;
  let listsImported = 0;
  // Maps the file's own per-item id -> the newly-created real item id, so
  // lists[].item_ids can be re-mapped to real ids below (issue #30 AC:
  // lists must reference the NEW items, never the stale file ids).
  const idMap = new Map<string, string>();

  for (const item of importFile.items) {
    const outcome = await importOneItem(supabase, user.id, categoryIdBySlug, item);
    if ("error" in outcome) {
      return { error: outcome.error, result: { itemsImported, listsImported, partial: true } };
    }
    idMap.set(item.id, outcome.newItemId);
    itemsImported += 1;
  }

  for (const list of importFile.lists) {
    const { data: insertedList, error: listError } = await supabase
      .from("lists")
      .insert({ user_id: user.id, name: list.name, created_at: list.created_at })
      .select("id")
      .single();

    if (listError || !insertedList) {
      return {
        error: `Import stopped while creating list "${list.name}". Please try again.`,
        result: { itemsImported, listsImported, partial: true },
      };
    }

    // The list row itself now exists -- counted as imported from this point
    // on, even if its membership insert below fails, so the reported count
    // matches what a mid-write failure actually leaves behind.
    listsImported += 1;

    if (list.item_ids.length > 0) {
      // Re-mapped through idMap (built above) -- never the file's own
      // (now-stale) item ids -- and sort_order preserves the file's
      // original array position (issue #30 AC).
      const memberRows = list.item_ids.map((fileItemId, index) => ({
        list_id: insertedList.id,
        item_id: idMap.get(fileItemId)!,
        sort_order: index,
      }));

      const { error: memberError } = await supabase.from("list_items").insert(memberRows);
      if (memberError) {
        return {
          error: `Import stopped while adding items to list "${list.name}". Please try again.`,
          result: { itemsImported, listsImported, partial: true },
        };
      }
    }
  }

  return {
    error: null,
    result: { itemsImported, listsImported, partial: false },
  };
}

// One item's full write: resolve subtype (match-or-create via
// createSubtypeAction, #18), insert the items row with dates taken as-is
// from the file, attach tags (match-or-create via addTagToItemAction, #17),
// insert links. images[]/attachments[] are read for shape validation only
// (lib/validation/import.ts) and never touched again here -- no
// item_images/item_attachments row is ever created, and no file is
// uploaded to Storage (issue #30 AC: there is no file to restore, since
// #29 never exports bytes; a metadata row with no backing Storage object
// would produce a broken image/download link).
async function importOneItem(
  supabase: SupabaseServerClient,
  userId: string,
  categoryIdBySlug: Map<string, string>,
  item: ImportItem,
): Promise<{ newItemId: string } | { error: string }> {
  const categoryId = categoryIdBySlug.get(item.category);
  if (!categoryId) {
    // Unreachable given the caller's own pre-loop check, but kept as a
    // defensive branch rather than a non-null assertion.
    return { error: `Unrecognized category "${item.category}".` };
  }

  // Match-or-create by trimmed, case-insensitive name -- reused as-is from
  // #18, not reimplemented. `item.subtype.is_custom` is never read: it's
  // informational only (round-trip fidelity), never drives match-vs-create
  // (issue #30's Constraints) -- createSubtypeAction's own lookup already
  // checks predefined-and-custom together by name alone.
  const subtypeResult = await createSubtypeAction(categoryId, item.subtype.name);
  if ("error" in subtypeResult) {
    return {
      error: `Import stopped while resolving subtype "${item.subtype.name}" for "${item.title}": ${subtypeResult.error}`,
    };
  }

  // created_at/updated_at/completed_at are written explicitly from the
  // file's values, not left to default/now() -- items_set_updated_at only
  // fires `before update`, never `before insert` (supabase/migrations/
  // 20260908130000_create_items_table.sql), so an explicit updated_at on
  // insert is preserved rather than immediately overwritten. `id` from the
  // file is never sent -- every imported item gets a fresh,
  // database-generated id (issue #30 AC).
  const { data: insertedItem, error: insertError } = await supabase
    .from("items")
    .insert({
      user_id: userId,
      category_id: categoryId,
      subtype_id: subtypeResult.subtype.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      rating: item.rating,
      notes: item.notes,
      review: item.review,
      created_at: item.created_at,
      updated_at: item.updated_at,
      completed_at: item.completed_at,
    })
    .select("id")
    .single();

  if (insertError || !insertedItem) {
    return { error: `Import stopped while creating item "${item.title}". Please try again.` };
  }

  const newItemId = insertedItem.id as string;

  for (const tag of item.tags) {
    // Same is_custom-is-informational-only reasoning as subtypes above --
    // addTagToItemAction (#17) is reused as-is for the find-or-create-and-
    // attach lookup.
    const tagResult = await addTagToItemAction(newItemId, tag.name);
    if ("error" in tagResult) {
      return {
        error: `Import stopped while attaching tag "${tag.name}" to "${item.title}": ${tagResult.error}`,
      };
    }
  }

  if (item.links.length > 0) {
    // No matching/dedup -- links have no identity to match on (issue #30
    // AC).
    const { error: linksError } = await supabase.from("item_links").insert(
      item.links.map((link) => ({ item_id: newItemId, url: link.url, label: link.label })),
    );
    if (linksError) {
      return {
        error: `Import stopped while saving links for "${item.title}". Please try again.`,
      };
    }
  }

  return { newItemId };
}
