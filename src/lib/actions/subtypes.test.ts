import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/subtypes.ts (issue #18), focused on the
// branches e2e coverage (e2e/subtype-creation.spec.ts) can exercise live but
// can't directly force/inspect: the lookup-before-create match/no-match
// split, the category-scoped lookup itself (a same-named subtype in a
// different category must never count as a duplicate), the insert-subtypes-
// row payload (user_id/category_id/trimmed name), and the unique-index-race
// fallback. Same createClient-mocking shape as lib/actions/tags.test.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { createSubtypeAction } = await import("./subtypes");

type FakeRow = Record<string, unknown> | null;

function categoriesTable(category: FakeRow) {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: category }) }),
    }),
  };
}

function fakeSupabase(options: {
  user?: { id: string } | null;
  category?: FakeRow;
  // Sequential responses to the category-scoped visible-subtypes lookup --
  // index 0 is the pre-insert lookup, index 1 (if present) is the
  // post-23505 re-query after a race.
  visibleSubtypesSequence?: Array<Array<Record<string, unknown>>>;
  insertResult?: {
    data: Record<string, unknown> | null;
    error: { code?: string; message: string } | null;
  };
}) {
  let orCallCount = 0;
  const eqMock = vi.fn(() => ({ or: orMock }));
  const orMock = vi.fn(async () => {
    const sequence = options.visibleSubtypesSequence ?? [[]];
    const data = sequence[orCallCount] ?? sequence[sequence.length - 1] ?? [];
    orCallCount += 1;
    return { data };
  });
  const singleMock = vi.fn(
    async () =>
      options.insertResult ?? { data: null, error: { message: "insert should not be called" } },
  );
  const insertMock = vi.fn(() => ({ select: () => ({ single: singleMock }) }));

  const fromMock = vi.fn((table: string) => {
    if (table === "categories") return categoriesTable(options.category ?? null);
    if (table === "subtypes") {
      return {
        select: () => ({ eq: eqMock }),
        insert: insertMock,
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    eqMock,
    orMock,
    insertMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
  };
}

const CATEGORY_ID = "cat-games";
const OTHER_CATEGORY_ID = "cat-books";

beforeEach(() => {
  createClientMock.mockReset();
});

describe("createSubtypeAction", () => {
  it("rejects an empty/whitespace-only name before ever calling createClient", async () => {
    const result = await createSubtypeAction(CATEGORY_ID, "   ");

    expect(result).toEqual({ error: expect.any(String) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a missing categoryId before ever calling createClient", async () => {
    const result = await createSubtypeAction("", "Roguelike");

    expect(result).toEqual({ error: expect.stringMatching(/select a category/i) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await createSubtypeAction(CATEGORY_ID, "Roguelike");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects a categoryId that doesn't match a real category, without ever querying subtypes", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, category: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await createSubtypeAction(CATEGORY_ID, "Roguelike");

    expect(result).toEqual({ error: expect.stringMatching(/does not exist/i) });
    expect(supabase.from).not.toHaveBeenCalledWith("subtypes");
  });

  it("finds the existing subtype on a trimmed, case-insensitive match within the same category instead of creating a duplicate", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: CATEGORY_ID },
      visibleSubtypesSequence: [[{ id: "subtype-roguelike", name: "Roguelike" }]],
    });
    createClientMock.mockResolvedValue(supabase);

    // Entering "roguelike" (lowercase, with padding whitespace) against an
    // existing "Roguelike" -- must find the existing row, never insert.
    const result = await createSubtypeAction(CATEGORY_ID, "  roguelike  ");

    expect(result).toEqual({ subtype: { id: "subtype-roguelike", name: "Roguelike" } });
    expect(supabase.insertMock).not.toHaveBeenCalled();
    expect(supabase.eqMock).toHaveBeenCalledWith("category_id", CATEGORY_ID);
  });

  it("creates a new user-owned subtype (storing the trimmed name as typed, scoped to categoryId) when no match exists in this category", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: CATEGORY_ID },
      visibleSubtypesSequence: [[]],
      insertResult: { data: { id: "subtype-new", name: "Metroidvania" }, error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await createSubtypeAction(CATEGORY_ID, "  Metroidvania  ");

    expect(result).toEqual({ subtype: { id: "subtype-new", name: "Metroidvania" } });
    expect(supabase.insertMock).toHaveBeenCalledWith({
      name: "Metroidvania",
      user_id: "user-1",
      category_id: CATEGORY_ID,
    });
  });

  it("a same-named subtype in a different category is never treated as a duplicate -- the lookup is scoped to categoryId", async () => {
    // The visible-subtypes lookup itself is category-scoped at the query
    // level (`.eq("category_id", categoryId)`) -- simulating "no match in
    // this category" (empty list) even though a same-named row exists
    // elsewhere, since the query would never return that other category's
    // row in the first place. This proves the create path is taken (not a
    // false-positive dedup) and that the scoping column/value actually sent
    // matches the category this call was made for.
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: OTHER_CATEGORY_ID },
      visibleSubtypesSequence: [[]],
      insertResult: { data: { id: "subtype-fiction", name: "Fantasy" }, error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await createSubtypeAction(OTHER_CATEGORY_ID, "Fantasy");

    expect(result).toEqual({ subtype: { id: "subtype-fiction", name: "Fantasy" } });
    expect(supabase.eqMock).toHaveBeenCalledWith("category_id", OTHER_CATEGORY_ID);
    expect(supabase.insertMock).toHaveBeenCalledWith({
      name: "Fantasy",
      user_id: "user-1",
      category_id: OTHER_CATEGORY_ID,
    });
  });

  it("falls back to the row that won the race (no raw unique-violation surfaced) when a concurrent insert hits subtypes_category_lower_name_user_key", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: CATEGORY_ID },
      // First lookup (pre-insert): no match yet. Second lookup (post-23505,
      // re-querying after the race): the row another concurrent request
      // just won.
      visibleSubtypesSequence: [[], [{ id: "subtype-winner", name: "Cozy Sim" }]],
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await createSubtypeAction(CATEGORY_ID, "cozy sim");

    expect(result).toEqual({ subtype: { id: "subtype-winner", name: "Cozy Sim" } });
  });

  it("surfaces a friendly error (not a raw Postgres error) for a non-23505 insert failure", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: CATEGORY_ID },
      visibleSubtypesSequence: [[]],
      insertResult: { data: null, error: { message: "network blip" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await createSubtypeAction(CATEGORY_ID, "Anything");

    expect(result).toEqual({ error: expect.stringMatching(/failed to create subtype/i) });
  });
});
