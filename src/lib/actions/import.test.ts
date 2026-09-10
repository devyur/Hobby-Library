import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/import.ts (issue #30), focused on what e2e
// coverage (e2e/import.spec.ts) can exercise live but can't directly force/
// inspect: every validation-rejection branch guaranteeing zero writes
// (malformed JSON, schema_version mismatch, structural errors, a dangling
// list->item reference, an unrecognized category), that is_custom is never
// read/passed through to createSubtypeAction/addTagToItemAction (both
// mocked here -- their own match-vs-create logic is covered by
// subtypes.test.ts/tags.test.ts, not re-tested here), that images/
// attachments never touch item_images/item_attachments, that list
// item_ids get re-mapped through the newly-created item ids (not the
// file's stale ids), and that running the same import twice produces two
// independent full sets (no de-dup). Same createClient-mocking shape as
// lib/actions/lists.test.ts/tags.test.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const createSubtypeActionMock = vi.fn();
vi.mock("@/lib/actions/subtypes", () => ({
  createSubtypeAction: (...args: unknown[]) => createSubtypeActionMock(...args),
}));

const addTagToItemActionMock = vi.fn();
vi.mock("@/lib/actions/tags", () => ({
  addTagToItemAction: (...args: unknown[]) => addTagToItemActionMock(...args),
}));

const { importLibraryAction } = await import("./import");
const { initialImportActionState } = await import("@/lib/validation/import");

type InsertSingleResult = { data: Record<string, unknown> | null; error: { message: string } | null };
type InsertResult = { error: { message: string } | null };

function fakeSupabase(options: {
  user?: { id: string } | null;
  categories?: Array<{ id: string; slug: string }>;
  itemInsertResults?: InsertSingleResult[];
  itemLinksInsertResults?: InsertResult[];
  listInsertResults?: InsertSingleResult[];
  listItemsInsertResults?: InsertResult[];
}) {
  let itemInsertCall = 0;
  let itemLinksCall = 0;
  let listInsertCall = 0;
  let listItemsCall = 0;

  const itemLinksInsertMock = vi.fn(async () => {
    const result = options.itemLinksInsertResults?.[itemLinksCall] ?? { error: null };
    itemLinksCall += 1;
    return result;
  });
  const listItemsInsertMock = vi.fn(async () => {
    const result = options.listItemsInsertResults?.[listItemsCall] ?? { error: null };
    listItemsCall += 1;
    return result;
  });

  const fromMock = vi.fn((table: string) => {
    if (table === "categories") {
      return { select: async () => ({ data: options.categories ?? [] }) };
    }
    if (table === "items") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => {
              const result = options.itemInsertResults?.[itemInsertCall] ?? {
                data: null,
                error: { message: "unexpected items insert" },
              };
              itemInsertCall += 1;
              return result;
            },
          }),
        }),
      };
    }
    if (table === "item_links") {
      return { insert: itemLinksInsertMock };
    }
    if (table === "lists") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => {
              const result = options.listInsertResults?.[listInsertCall] ?? {
                data: null,
                error: { message: "unexpected lists insert" },
              };
              listInsertCall += 1;
              return result;
            },
          }),
        }),
      };
    }
    if (table === "list_items") {
      return { insert: listItemsInsertMock };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    itemLinksInsertMock,
    listItemsInsertMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
  };
}

const CATEGORY_ID = "cat-games";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-item-1",
    title: "Mass Effect 2",
    category: "games",
    subtype: { name: "RPG", is_custom: false },
    status: "completed",
    priority: "high",
    rating: 9,
    notes: "great",
    review: "loved it",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    completed_at: "2024-01-02T00:00:00.000Z",
    tags: [{ name: "Coop", is_custom: false }],
    links: [{ url: "https://example.com", label: "Store" }],
    images: [
      {
        storage_path: "user/item/cover",
        is_cover: true,
        sort_order: 0,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ],
    attachments: [
      {
        filename: "notes.pdf",
        mime_type: "application/pdf",
        size_bytes: 111,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function sampleFile(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    exported_at: "2024-01-03T00:00:00.000Z",
    items: [baseItem()],
    lists: [{ name: "Backlog", created_at: "2024-01-01T00:00:00.000Z", item_ids: ["file-item-1"] }],
    ...overrides,
  };
}

function formDataWithFile(content: unknown, asRawText?: string): FormData {
  const text = asRawText ?? JSON.stringify(content);
  const file = new File([text], "export.json", { type: "application/json" });
  const formData = new FormData();
  formData.set("file", file);
  return formData;
}

beforeEach(() => {
  createClientMock.mockReset();
  createSubtypeActionMock.mockReset();
  addTagToItemActionMock.mockReset();
});

describe("importLibraryAction", () => {
  it("rejects when no file is chosen, without touching the database", async () => {
    const formData = new FormData();
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/choose a file/i);
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects malformed (not valid) JSON with zero writes", async () => {
    const formData = formDataWithFile(null, "{ not valid json");
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/valid json/i);
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a schema_version other than 1 with zero writes", async () => {
    const formData = formDataWithFile(sampleFile({ schema_version: 2 }));
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/unsupported export file version/i);
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a file with a missing schema_version the same way", async () => {
    const file = sampleFile();
    delete (file as Record<string, unknown>).schema_version;
    const formData = formDataWithFile(file);
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/unsupported export file version/i);
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a missing required field (title) with zero writes", async () => {
    const formData = formDataWithFile(
      sampleFile({ items: [baseItem({ title: "" })] }),
    );
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/title/i);
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range rating with zero writes", async () => {
    const formData = formDataWithFile(sampleFile({ items: [baseItem({ rating: 11 })] }));
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toBeTruthy();
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized status value with zero writes", async () => {
    const formData = formDataWithFile(
      sampleFile({ items: [baseItem({ status: "archived" })] }),
    );
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toBeTruthy();
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a list referencing an item id not present in the file, with zero writes", async () => {
    const formData = formDataWithFile(
      sampleFile({
        lists: [{ name: "Backlog", created_at: "2024-01-01T00:00:00.000Z", item_ids: ["not-a-real-id"] }],
      }),
    );
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/item id not present/i);
    expect(result.result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized category slug before any item/list insert", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      categories: [{ id: CATEGORY_ID, slug: "games" }],
    });
    createClientMock.mockResolvedValue(supabase);

    const formData = formDataWithFile(sampleFile({ items: [baseItem({ category: "gadgets" })] }));
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toMatch(/unrecognized category/i);
    expect(result.result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalledWith("items");
    expect(supabase.from).not.toHaveBeenCalledWith("lists");
  });

  it("imports a well-formed file fully: item, tag, link, and list membership re-mapped to the new item id", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      categories: [{ id: CATEGORY_ID, slug: "games" }],
      itemInsertResults: [{ data: { id: "new-item-1" }, error: null }],
      listInsertResults: [{ data: { id: "new-list-1" }, error: null }],
    });
    createClientMock.mockResolvedValue(supabase);
    createSubtypeActionMock.mockResolvedValue({ subtype: { id: "subtype-1", name: "RPG" } });
    addTagToItemActionMock.mockResolvedValue({ tag: { id: "tag-1", name: "Coop" } });

    const formData = formDataWithFile(sampleFile());
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ itemsImported: 1, listsImported: 1, partial: false });

    // Subtype/tag lookups are called by name -- is_custom from the file is
    // never passed through (issue #30's Constraints).
    expect(createSubtypeActionMock).toHaveBeenCalledWith(CATEGORY_ID, "RPG");
    expect(addTagToItemActionMock).toHaveBeenCalledWith("new-item-1", "Coop");

    // list_items references the NEW item id, never the file's stale
    // "file-item-1" id.
    expect(supabase.listItemsInsertMock).toHaveBeenCalledWith([
      { list_id: "new-list-1", item_id: "new-item-1", sort_order: 0 },
    ]);

    expect(supabase.itemLinksInsertMock).toHaveBeenCalledWith([
      { item_id: "new-item-1", url: "https://example.com", label: "Store" },
    ]);

    // images/attachments were present in the file (shape-validated) but
    // never produce item_images/item_attachments rows.
    expect(supabase.from).not.toHaveBeenCalledWith("item_images");
    expect(supabase.from).not.toHaveBeenCalledWith("item_attachments");
  });

  it("never reads item.subtype.is_custom / tag.is_custom to decide match-vs-create -- always a name-only lookup", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      categories: [{ id: CATEGORY_ID, slug: "games" }],
      itemInsertResults: [{ data: { id: "new-item-1" }, error: null }],
      listInsertResults: [{ data: { id: "new-list-1" }, error: null }],
    });
    createClientMock.mockResolvedValue(supabase);
    createSubtypeActionMock.mockResolvedValue({ subtype: { id: "subtype-1", name: "RPG" } });
    addTagToItemActionMock.mockResolvedValue({ tag: { id: "tag-1", name: "Coop" } });

    // is_custom: true on both, even though the action must still just call
    // createSubtypeAction/addTagToItemAction with the plain name -- those
    // functions themselves decide match vs. create, this action never does.
    const formData = formDataWithFile(
      sampleFile({
        items: [
          baseItem({
            subtype: { name: "RPG", is_custom: true },
            tags: [{ name: "Coop", is_custom: true }],
          }),
        ],
      }),
    );
    await importLibraryAction(initialImportActionState, formData);

    expect(createSubtypeActionMock).toHaveBeenCalledWith(CATEGORY_ID, "RPG");
    expect(addTagToItemActionMock).toHaveBeenCalledWith("new-item-1", "Coop");
  });

  it("stops and reports partial success (not a rollback) on a mid-write database failure", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      categories: [{ id: CATEGORY_ID, slug: "games" }],
      itemInsertResults: [{ data: null, error: { message: "db exploded" } }],
    });
    createClientMock.mockResolvedValue(supabase);
    createSubtypeActionMock.mockResolvedValue({ subtype: { id: "subtype-1", name: "RPG" } });

    const formData = formDataWithFile(sampleFile());
    const result = await importLibraryAction(initialImportActionState, formData);

    expect(result.error).toBeTruthy();
    // Distinct from the zero-writes validation-failure case: result is set,
    // not null, even though nothing actually succeeded here.
    expect(result.result).toEqual({ itemsImported: 0, listsImported: 0, partial: true });
  });

  it("running the same import twice produces two independent full sets (no de-duplication)", async () => {
    const makeSupabase = () =>
      fakeSupabase({
        user: { id: "user-1" },
        categories: [{ id: CATEGORY_ID, slug: "games" }],
        itemInsertResults: [{ data: { id: "new-item-run" }, error: null }],
        listInsertResults: [{ data: { id: "new-list-run" }, error: null }],
      });
    createSubtypeActionMock.mockResolvedValue({ subtype: { id: "subtype-1", name: "RPG" } });
    addTagToItemActionMock.mockResolvedValue({ tag: { id: "tag-1", name: "Coop" } });

    const supabaseA = makeSupabase();
    createClientMock.mockResolvedValueOnce(supabaseA);
    const resultA = await importLibraryAction(initialImportActionState, formDataWithFile(sampleFile()));
    expect(resultA.result).toEqual({ itemsImported: 1, listsImported: 1, partial: false });

    const supabaseB = makeSupabase();
    createClientMock.mockResolvedValueOnce(supabaseB);
    const resultB = await importLibraryAction(initialImportActionState, formDataWithFile(sampleFile()));
    expect(resultB.result).toEqual({ itemsImported: 1, listsImported: 1, partial: false });

    // Each run inserted its own fresh items/lists row -- no lookup/matching
    // against what the first run created.
    expect(supabaseA.from).toHaveBeenCalledWith("items");
    expect(supabaseB.from).toHaveBeenCalledWith("items");
  });
});
