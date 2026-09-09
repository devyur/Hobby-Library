import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for getTrashedItems (issue #25) -- mocks the Supabase client
// the same way lib/queries/items.test.ts does, isolating the query shape
// (explicit user_id scoping, deleted_at IS NOT NULL, deleted_at desc order,
// embedded category/subtype normalization) from the live database. The live
// cross-category/RLS behavior is covered separately by e2e/trash.spec.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { getTrashedItems } = await import("./trash");

function fakeSupabase(options: {
  user?: { id: string } | null;
  itemsResult?: { data: unknown[] | null; error: { message: string } | null };
}) {
  const itemsResult = options.itemsResult ?? { data: [], error: null };

  const orderMock = vi.fn().mockResolvedValue(itemsResult);
  const notMock = vi.fn(() => ({ order: orderMock }));
  const eqMock = vi.fn(() => ({ not: notMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return { select: selectMock };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    selectMock,
    eqMock,
    notMock,
    orderMock,
  };
}

describe("getTrashedItems", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns an empty list without querying items when unauthenticated", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await getTrashedItems();

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("scopes explicitly by user_id, filters deleted_at IS NOT NULL, and orders deleted_at desc", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    await getTrashedItems();

    expect(supabase.eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(supabase.notMock).toHaveBeenCalledWith("deleted_at", "is", null);
    expect(supabase.orderMock).toHaveBeenCalledWith("deleted_at", { ascending: false });
  });

  it("normalizes embedded category/subtype rows into flat fields", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: {
        data: [
          {
            id: "item-1",
            title: "Old Game",
            deleted_at: "2026-09-01T00:00:00.000Z",
            categories: { slug: "games", name: "Games" },
            subtypes: { name: "RPG" },
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getTrashedItems();

    expect(result).toEqual([
      {
        id: "item-1",
        title: "Old Game",
        categorySlug: "games",
        categoryName: "Games",
        subtypeName: "RPG",
        deletedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list (not a thrown error) when the query itself errors", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      itemsResult: { data: null, error: { message: "boom" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getTrashedItems();

    expect(result).toEqual([]);
  });
});
