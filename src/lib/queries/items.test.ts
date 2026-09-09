import { beforeEach, describe, expect, it, vi } from "vitest";

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
}

function fakeSupabase(options: {
  rpcResult?: { data: { id: string }[] | null; error: { message: string } | null };
  itemsResult?: { data: unknown[] | null; error: { message: string } | null };
}) {
  const itemsResult = options.itemsResult ?? { data: [], error: null };

  const itemsQuery: FakeItemsQuery = {
    select: vi.fn(() => itemsQuery),
    eq: vi.fn(() => itemsQuery),
    is: vi.fn(() => itemsQuery),
    order: vi.fn(() => itemsQuery),
    in: vi.fn(() => itemsQuery),
    then: (onFulfilled, onRejected) => Promise.resolve(itemsResult).then(onFulfilled, onRejected),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsQuery;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const rpcMock = vi.fn().mockResolvedValue(options.rpcResult ?? { data: [], error: null });

  return { from: fromMock, rpc: rpcMock, itemsQuery };
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
