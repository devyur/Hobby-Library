import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LibrarySort } from "./items";

// Unit coverage for getLibraryItems' search-term parameter (issue #22).
// Mocks the Supabase client the same way lib/actions/items.test.ts does --
// this isolates the two-query shape (search_item_ids() RPC, then the
// existing items select scoped via .in()) from the live database, so these
// assertions hold regardless of what's actually seeded in Supabase. The
// live-data behavior (trigram matching, category scoping, RLS) is covered
// separately by e2e/search.spec.ts against the real project.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { getLibraryItems } = await import("./items");

interface FakeItemsQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
}

interface FakeItemTagsQuery
  extends PromiseLike<{ data: { item_id: string }[] | null; error: { message: string } | null }> {
  select: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
}

function fakeSupabase(options: {
  rpcResult?: { data: { id: string }[] | null; error: { message: string } | null };
  itemsResult?: { data: unknown[] | null; error: { message: string } | null };
  itemTagsResult?: { data: { item_id: string }[] | null; error: { message: string } | null };
}) {
  const itemsResult = options.itemsResult ?? { data: [], error: null };
  const itemTagsResult = options.itemTagsResult ?? { data: [], error: null };

  const itemsQuery: FakeItemsQuery = {
    select: vi.fn(() => itemsQuery),
    eq: vi.fn(() => itemsQuery),
    is: vi.fn(() => itemsQuery),
    order: vi.fn(() => itemsQuery),
    in: vi.fn(() => itemsQuery),
    gte: vi.fn(() => itemsQuery),
    then: (onFulfilled, onRejected) => Promise.resolve(itemsResult).then(onFulfilled, onRejected),
  };

  const itemTagsQuery: FakeItemTagsQuery = {
    select: vi.fn(() => itemTagsQuery),
    in: vi.fn(() => itemTagsQuery),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(itemTagsResult).then(onFulfilled, onRejected),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsQuery;
    if (table === "item_tags") return itemTagsQuery;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const rpcMock = vi.fn().mockResolvedValue(options.rpcResult ?? { data: [], error: null });

  // getPublicUrl() is synchronous and, unlike createSignedUrl(), never
  // errors -- issue #38's public `covers` bucket resolution.
  const getPublicUrlMock = vi.fn((path: string) => ({
    data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/covers/${path}` },
  }));
  const storageFromMock = vi.fn(() => ({ getPublicUrl: getPublicUrlMock }));

  return {
    from: fromMock,
    rpc: rpcMock,
    itemsQuery,
    itemTagsQuery,
    storage: { from: storageFromMock },
    getPublicUrlMock,
    storageFromMock,
  };
}

describe("getLibraryItems", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("with no search term, never calls the search_item_ids RPC and queries items scoped only by category/deleted_at", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1");

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.itemsQuery.eq).toHaveBeenCalledWith("category_id", "cat-1");
    expect(supabase.itemsQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(supabase.itemsQuery.in).not.toHaveBeenCalled();
  });

  it("with a blank (whitespace-only) search term, behaves identically to no term -- no RPC call", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", "   ");

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.itemsQuery.in).not.toHaveBeenCalled();
  });

  it("with a search term, calls search_item_ids with the trimmed term and the category id, then scopes the items query to the returned ids", async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: [{ id: "item-1" }, { id: "item-2" }], error: null },
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "The Witcher 3",
            status: "planned",
            rating: null,
            priority: null,
            subtypes: null,
            item_tags: [],
            item_images: [],
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1", "  witch  ");

    expect(supabase.rpc).toHaveBeenCalledWith("search_item_ids", {
      p_category_id: "cat-1",
      p_search_term: "witch",
    });
    expect(supabase.itemsQuery.in).toHaveBeenCalledWith("id", ["item-1", "item-2"]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("The Witcher 3");
  });

  it("returns an empty list without querying items at all when search_item_ids finds zero matches", async () => {
    const supabase = fakeSupabase({ rpcResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1", "zzzzz");

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });

  it("returns an empty list (not a thrown error) when the search RPC itself errors", async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: null, error: { message: "boom" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1", "term");

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });
});

// Unit coverage for getLibraryItems' filter parameters (issue #23) --
// subtype/status/rating are asserted as plain `.eq`/`.gte` calls against the
// `items` query, and tagIds' OR-match + its AND-combination with an active
// search term are asserted via the two id lists getLibraryItems intersects
// before ever building the main `items` query. Live matching behavior
// (RLS, the actual tag join, a real zero-match combination) is covered
// separately by e2e/filters.spec.ts against the real project.
describe("getLibraryItems filters", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("applies subtype/status/minRating as .eq/.eq/.gte against the items query", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", undefined, {
      subtypeId: "subtype-1",
      status: "planned",
      minRating: 8,
    });

    expect(supabase.itemsQuery.eq).toHaveBeenCalledWith("subtype_id", "subtype-1");
    expect(supabase.itemsQuery.eq).toHaveBeenCalledWith("status", "planned");
    expect(supabase.itemsQuery.gte).toHaveBeenCalledWith("rating", 8);
  });

  it("with no filters passed, never calls .gte (rating) or the item_tags table", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1");

    expect(supabase.itemsQuery.gte).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalledWith("item_tags");
  });

  it("tagIds queries item_tags for any of the selected tags (OR-match), then scopes items to the returned ids", async () => {
    const supabase = fakeSupabase({
      itemTagsResult: {
        data: [{ item_id: "item-1" }, { item_id: "item-2" }, { item_id: "item-1" }],
        error: null,
      },
      itemsResult: { data: [], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", undefined, { tagIds: ["tag-a", "tag-b"] });

    expect(supabase.itemTagsQuery.in).toHaveBeenCalledWith("tag_id", ["tag-a", "tag-b"]);
    // Deduplicated (item-1 appeared twice, once per matching tag).
    expect(supabase.itemsQuery.in).toHaveBeenCalledWith(
      "id",
      expect.arrayContaining(["item-1", "item-2"]),
    );
    expect((supabase.itemsQuery.in.mock.calls[0][1] as string[]).length).toBe(2);
  });

  it("returns an empty list without querying items at all when the tag filter matches zero items", async () => {
    const supabase = fakeSupabase({ itemTagsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1", undefined, { tagIds: ["tag-a"] });

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });

  it("returns an empty list (not a thrown error) when the item_tags query itself errors", async () => {
    const supabase = fakeSupabase({
      itemTagsResult: { data: null, error: { message: "boom" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1", undefined, { tagIds: ["tag-a"] });

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });

  it("intersects the search-match id list with the tag-match id list (AND, not one overwriting the other) when both are active", async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: [{ id: "item-1" }, { id: "item-2" }], error: null },
      itemTagsResult: { data: [{ item_id: "item-2" }, { item_id: "item-3" }], error: null },
      itemsResult: { data: [], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", "witch", { tagIds: ["tag-a"] });

    // Only item-2 is in both the search-match and tag-match id lists.
    expect(supabase.itemsQuery.in).toHaveBeenCalledWith("id", ["item-2"]);
  });

  it("returns an empty list without querying items when the search and tag id lists don't intersect", async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: [{ id: "item-1" }], error: null },
      itemTagsResult: { data: [{ item_id: "item-2" }], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1", "witch", { tagIds: ["tag-a"] });

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });
});

// Unit coverage for getLibraryItems' `sort` parameter (issue #24) --
// asserts the exact `.order(...)` calls (column + ascending flag, and
// ordering of calls -- Priority/Status's own rank first, created_at desc as
// the tie-breaker second) issued against the `items` query, since that's
// the one thing this mocked-Supabase-client setup can actually observe:
// whether the rank is genuinely computed Postgres-side (the live
// `item_priority_rank`/`item_status_rank` computed fields, migration
// 20260909160000) is covered separately by e2e/sort.spec.ts against the
// real project.
describe("getLibraryItems sort", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("with no sort passed, orders by created_at desc alone -- unchanged from before this issue", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1");

    expect(supabase.itemsQuery.order).toHaveBeenCalledTimes(1);
    expect(supabase.itemsQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("sort='recently_added' behaves identically to omitting sort -- created_at desc alone", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", undefined, undefined, "recently_added" satisfies LibrarySort);

    expect(supabase.itemsQuery.order).toHaveBeenCalledTimes(1);
    expect(supabase.itemsQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("sort='priority' orders by the item_priority_rank computed field ascending, then created_at desc as the tie-breaker", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", undefined, undefined, "priority" satisfies LibrarySort);

    expect(supabase.itemsQuery.order).toHaveBeenNthCalledWith(1, "item_priority_rank", {
      ascending: true,
    });
    expect(supabase.itemsQuery.order).toHaveBeenNthCalledWith(2, "created_at", {
      ascending: false,
    });
    expect(supabase.itemsQuery.order).toHaveBeenCalledTimes(2);
  });

  it("sort='status' orders by the item_status_rank computed field ascending, then created_at desc as the tie-breaker", async () => {
    const supabase = fakeSupabase({ itemsResult: { data: [], error: null } });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", undefined, undefined, "status" satisfies LibrarySort);

    expect(supabase.itemsQuery.order).toHaveBeenNthCalledWith(1, "item_status_rank", {
      ascending: true,
    });
    expect(supabase.itemsQuery.order).toHaveBeenNthCalledWith(2, "created_at", {
      ascending: false,
    });
    expect(supabase.itemsQuery.order).toHaveBeenCalledTimes(2);
  });

  it("sort composes with an active search term/filters (same matchingIds narrowing applied regardless of sort)", async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: [{ id: "item-1" }], error: null },
      itemsResult: { data: [], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    await getLibraryItems("cat-1", "witch", { status: "planned" }, "status");

    expect(supabase.itemsQuery.in).toHaveBeenCalledWith("id", ["item-1"]);
    expect(supabase.itemsQuery.eq).toHaveBeenCalledWith("status", "planned");
    expect(supabase.itemsQuery.order).toHaveBeenNthCalledWith(1, "item_status_rank", {
      ascending: true,
    });
  });
});

// Unit coverage for cover URL resolution (issue #38): the `covers` bucket
// is public, so getLibraryItems/getItemDetail resolve coverUrl via
// getPublicUrl() (synchronous, never errors) instead of createSignedUrl(),
// with a `?v=` cache-busting param sourced from item_images.updated_at.
// Live verification that the bucket is genuinely public and that the
// `?v=` value actually changes bytes-for-bytes on a replace is
// e2e/cover-upload.spec.ts's/a live-fetch job's concern, not this mocked
// unit -- this only asserts the URL-building logic itself.
describe("getLibraryItems cover URL resolution", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("resolves coverUrl via getPublicUrl() against the cover row's storage_path, appending ?v=<updated_at as epoch ms>", async () => {
    const updatedAt = "2026-09-10T12:00:00.000Z";
    const supabase = fakeSupabase({
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "Portal 2",
            status: "planned",
            rating: null,
            priority: null,
            subtypes: null,
            item_tags: [],
            item_images: [
              { storage_path: "user-1/item-1/cover", is_cover: true, updated_at: updatedAt },
            ],
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1");

    expect(supabase.storageFromMock).toHaveBeenCalledWith("covers");
    expect(supabase.getPublicUrlMock).toHaveBeenCalledWith("user-1/item-1/cover");
    expect(result[0].coverUrl).toBe(
      `https://fake.supabase.co/storage/v1/object/public/covers/user-1/item-1/cover?v=${new Date(updatedAt).getTime()}`,
    );
  });

  it("with no is_cover=true row, coverUrl is null and getPublicUrl is never called", async () => {
    const supabase = fakeSupabase({
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "No Cover Item",
            status: "planned",
            rating: null,
            priority: null,
            subtypes: null,
            item_tags: [],
            item_images: [],
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLibraryItems("cat-1");

    expect(result[0].coverUrl).toBeNull();
    expect(supabase.getPublicUrlMock).not.toHaveBeenCalled();
  });
});
