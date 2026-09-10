import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for buildExportData (issue #29), mocking the Supabase
// client the same self-returning-thenable way lib/queries/items.test.ts
// does -- this isolates the JSON-shape assembly (empty-array defaults,
// is_custom derivation, dangling-membership dropping) from the live
// database. The live auth/RLS/cross-user-isolation behavior and the actual
// download response are covered separately by e2e/export.spec.ts against
// the real project.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { buildExportData } = await import("./export");

interface FakeQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
}

function makeQuery(result: { data: unknown; error: { message: string } | null }): FakeQuery {
  const query = {} as FakeQuery;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return query;
}

function fakeSupabase(options: {
  user?: { id: string } | null;
  itemsResult?: { data: unknown; error: { message: string } | null };
  listsResult?: { data: unknown; error: { message: string } | null };
  listItemsResult?: { data: unknown; error: { message: string } | null };
}) {
  const itemsQuery = makeQuery(options.itemsResult ?? { data: [], error: null });
  const listsQuery = makeQuery(options.listsResult ?? { data: [], error: null });
  const listItemsQuery = makeQuery(options.listItemsResult ?? { data: [], error: null });

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsQuery;
    if (table === "lists") return listsQuery;
    if (table === "list_items") return listItemsQuery;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    itemsQuery,
    listsQuery,
    listItemsQuery,
  };
}

describe("buildExportData", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns null without querying anything when unauthenticated", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await buildExportData();

    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns the empty-library shape for a user with zero items/lists", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await buildExportData();

    expect(result?.schema_version).toBe(1);
    expect(typeof result?.exported_at).toBe("string");
    expect(result?.items).toEqual([]);
    expect(result?.lists).toEqual([]);
    // list_items is never queried when the caller owns zero lists.
    expect(supabase.listItemsQuery.in).not.toHaveBeenCalled();
  });

  it("scopes items/lists explicitly by user_id and excludes trashed items via deleted_at IS NULL", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    await buildExportData();

    expect(supabase.itemsQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(supabase.itemsQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(supabase.listsQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("serializes an item with all relations populated to the exact documented shape", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "Mass Effect 2",
            status: "completed",
            priority: "high",
            rating: 9,
            notes: "some notes",
            review: "some review",
            created_at: "2026-01-04T10:00:00.000Z",
            updated_at: "2026-03-01T12:00:00.000Z",
            completed_at: "2026-02-20T00:00:00.000Z",
            categories: { slug: "games" },
            subtypes: { name: "RPG", user_id: null },
            item_tags: [
              { tags: { name: "sci-fi", user_id: null } },
              { tags: { name: "my-custom-tag", user_id: "user-1" } },
            ],
            item_links: [{ url: "https://example.com", label: "Store page" }],
            item_images: [
              {
                storage_path: "user-1/item-1/cover",
                is_cover: true,
                sort_order: 0,
                created_at: "2026-01-05T00:00:00.000Z",
              },
            ],
            item_attachments: [
              {
                filename: "notes.pdf",
                mime_type: "application/pdf",
                size_bytes: 12345,
                created_at: "2026-01-06T00:00:00.000Z",
              },
            ],
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await buildExportData();

    expect(result?.items).toEqual([
      {
        id: "item-1",
        title: "Mass Effect 2",
        category: "games",
        subtype: { name: "RPG", is_custom: false },
        status: "completed",
        priority: "high",
        rating: 9,
        notes: "some notes",
        review: "some review",
        created_at: "2026-01-04T10:00:00.000Z",
        updated_at: "2026-03-01T12:00:00.000Z",
        completed_at: "2026-02-20T00:00:00.000Z",
        tags: [
          { name: "sci-fi", is_custom: false },
          { name: "my-custom-tag", is_custom: true },
        ],
        links: [{ url: "https://example.com", label: "Store page" }],
        images: [
          {
            storage_path: "user-1/item-1/cover",
            is_cover: true,
            sort_order: 0,
            created_at: "2026-01-05T00:00:00.000Z",
          },
        ],
        attachments: [
          {
            filename: "notes.pdf",
            mime_type: "application/pdf",
            size_bytes: 12345,
            created_at: "2026-01-06T00:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("serializes an item with no relations with empty arrays, not omitted keys or nulls", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "Bare Item",
            status: "planned",
            priority: null,
            rating: null,
            notes: null,
            review: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            completed_at: null,
            categories: { slug: "books" },
            subtypes: { name: "Novel", user_id: null },
            item_tags: [],
            item_links: [],
            item_images: [],
            item_attachments: [],
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await buildExportData();

    expect(result?.items[0]).toMatchObject({
      tags: [],
      links: [],
      images: [],
      attachments: [],
    });
  });

  it("a custom subtype serializes with is_custom: true", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "Homebrew Thing",
            status: "planned",
            priority: null,
            rating: null,
            notes: null,
            review: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            completed_at: null,
            categories: { slug: "games" },
            subtypes: { name: "Homebrew Genre", user_id: "user-1" },
            item_tags: [],
            item_links: [],
            item_images: [],
            item_attachments: [],
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await buildExportData();

    expect(result?.items[0]?.subtype).toEqual({ name: "Homebrew Genre", is_custom: true });
  });

  it("drops a list_items membership pointing at a trashed (excluded) item, without leaving it dangling", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: {
        data: [
          {
            id: "item-kept",
            title: "Kept Item",
            status: "planned",
            priority: null,
            rating: null,
            notes: null,
            review: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            completed_at: null,
            categories: { slug: "games" },
            subtypes: { name: "RPG", user_id: null },
            item_tags: [],
            item_links: [],
            item_images: [],
            item_attachments: [],
          },
        ],
        error: null,
      },
      listsResult: {
        data: [{ id: "list-1", name: "Backlog", created_at: "2026-01-01T00:00:00.000Z" }],
        error: null,
      },
      // item-trashed is NOT in itemsResult above (excluded, as if soft-deleted).
      listItemsResult: {
        data: [
          { list_id: "list-1", item_id: "item-kept" },
          { list_id: "list-1", item_id: "item-trashed" },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await buildExportData();

    expect(result?.lists).toEqual([
      {
        name: "Backlog",
        created_at: "2026-01-01T00:00:00.000Z",
        item_ids: ["item-kept"],
      },
    ]);
  });

  it("throws when the items query errors, rather than returning a partial export", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: { data: null, error: { message: "boom" } },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(buildExportData()).rejects.toThrow(/boom/);
  });
});
