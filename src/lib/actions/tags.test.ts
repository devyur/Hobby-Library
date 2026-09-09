import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/tags.ts (issue #17), focused on the branches
// e2e coverage (e2e/item-tags.spec.ts) can exercise live but can't directly
// force/inspect: the lookup-before-create match/no-match split, the
// insert-tags-row payload (user_id/trimmed name), the unique-index-race
// fallback, and duplicate-attach-is-a-no-op handling. Same
// createClient-mocking shape as lib/actions/items.test.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { attachTagAction, detachTagAction, addTagToItemAction } = await import("./tags");

type FakeRow = Record<string, unknown> | null;

function itemsTable(item: FakeRow) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({ maybeSingle: async () => ({ data: item }) }),
        }),
      }),
    }),
  };
}

function fakeSupabase(options: {
  user?: { id: string } | null;
  item?: FakeRow;
}) {
  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsTable(options.item ?? null);
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
  };
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("attachTagAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await attachTagAction("item-1", "tag-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one -- a plain error, never a distinguishable RLS/Postgres error", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await attachTagAction("someone-elses-item", "tag-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
  });

  it("rejects attaching a tag not visible to this user (another user's private tag), without ever calling item_tags", async () => {
    const insertMock = vi.fn();
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({
            eq: () => ({ or: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          }),
        };
      }
      if (table === "item_tags") return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await attachTagAction("item-1", "someone-elses-tag");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("attaches a visible tag by id", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({
            eq: () => ({
              or: () => ({ maybeSingle: async () => ({ data: { id: "tag-1", name: "RPG" } }) }),
            }),
          }),
        };
      }
      if (table === "item_tags") return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await attachTagAction("item-1", "tag-1");

    expect(result).toEqual({ tag: { id: "tag-1", name: "RPG" } });
    expect(insertMock).toHaveBeenCalledWith({ item_id: "item-1", tag_id: "tag-1" });
  });

  it("treats a duplicate-attach (item_tags PK violation, code 23505) as a no-op success, not an error", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: { code: "23505", message: "dup" } });
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({
            eq: () => ({
              or: () => ({ maybeSingle: async () => ({ data: { id: "tag-1", name: "RPG" } }) }),
            }),
          }),
        };
      }
      if (table === "item_tags") return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await attachTagAction("item-1", "tag-1");

    expect(result).toEqual({ tag: { id: "tag-1", name: "RPG" } });
  });
});

describe("detachTagAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await detachTagAction("item-1", "tag-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("deletes only the item_tags row for this (item, tag) pair -- never touches the tags table", async () => {
    const secondEq = vi.fn().mockResolvedValue({ error: null });
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const deleteMock = vi.fn(() => ({ eq: firstEq }));
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "item_tags") return { delete: deleteMock };
      throw new Error(`Unexpected table (detach must never touch it): ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await detachTagAction("item-1", "tag-1");

    expect(result).toEqual({ success: true });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(firstEq).toHaveBeenCalledWith("item_id", "item-1");
    expect(secondEq).toHaveBeenCalledWith("tag_id", "tag-1");
    expect(fromMock).not.toHaveBeenCalledWith("tags");
  });
});

describe("addTagToItemAction", () => {
  it("rejects an empty/whitespace-only name before ever calling createClient", async () => {
    const result = await addTagToItemAction("item-1", "   ");

    expect(result).toEqual({ error: expect.any(String) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await addTagToItemAction("item-1", "python");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("attaches the existing tag on a trimmed, case-insensitive match instead of creating a duplicate", async () => {
    const tagsInsertMock = vi.fn();
    const itemTagsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({
            or: async () => ({ data: [{ id: "tag-python", name: "Python" }] }),
          }),
          insert: tagsInsertMock,
        };
      }
      if (table === "item_tags") return { insert: itemTagsInsertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    // Entering "python" (lowercase, with padding whitespace) against an
    // existing "Python" -- must attach the existing row, never call
    // tags.insert.
    const result = await addTagToItemAction("item-1", "  python  ");

    expect(result).toEqual({ tag: { id: "tag-python", name: "Python" } });
    expect(tagsInsertMock).not.toHaveBeenCalled();
    expect(itemTagsInsertMock).toHaveBeenCalledWith({
      item_id: "item-1",
      tag_id: "tag-python",
    });
  });

  it("creates a new user-owned tag storing the trimmed name as typed (not lowercased) when no match exists", async () => {
    const singleMock = vi
      .fn()
      .mockResolvedValue({ data: { id: "tag-new", name: "Speedrunning" }, error: null });
    const tagsInsertMock = vi.fn(() => ({ select: () => ({ single: singleMock }) }));
    const itemTagsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({ or: async () => ({ data: [] }) }),
          insert: tagsInsertMock,
        };
      }
      if (table === "item_tags") return { insert: itemTagsInsertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await addTagToItemAction("item-1", "  Speedrunning  ");

    expect(result).toEqual({ tag: { id: "tag-new", name: "Speedrunning" } });
    expect(tagsInsertMock).toHaveBeenCalledWith({ name: "Speedrunning", user_id: "user-1" });
    expect(itemTagsInsertMock).toHaveBeenCalledWith({
      item_id: "item-1",
      tag_id: "tag-new",
    });
  });

  it("falls back to attaching the existing tag (no raw unique-violation surfaced) when a race hits the new unique index", async () => {
    const singleMock = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    const tagsInsertMock = vi.fn(() => ({ select: () => ({ single: singleMock }) }));
    const itemTagsInsertMock = vi.fn().mockResolvedValue({ error: null });
    let selectCallCount = 0;
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({
            or: async () => {
              selectCallCount += 1;
              // First lookup (pre-insert): no match yet. Second lookup
              // (post-23505, re-querying after the race): the row another
              // concurrent request just won.
              return selectCallCount === 1
                ? { data: [] }
                : { data: [{ id: "tag-winner", name: "Cozy" }] };
            },
          }),
          insert: tagsInsertMock,
        };
      }
      if (table === "item_tags") return { insert: itemTagsInsertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await addTagToItemAction("item-1", "cozy");

    expect(result).toEqual({ tag: { id: "tag-winner", name: "Cozy" } });
    expect(itemTagsInsertMock).toHaveBeenCalledWith({
      item_id: "item-1",
      tag_id: "tag-winner",
    });
  });

  it("treats a duplicate-attach (item_tags PK violation, code 23505) as a no-op success, not an error", async () => {
    const singleMock = vi
      .fn()
      .mockResolvedValue({ data: { id: "tag-new", name: "Cozy" }, error: null });
    const tagsInsertMock = vi.fn(() => ({ select: () => ({ single: singleMock }) }));
    const itemTagsInsertMock = vi
      .fn()
      .mockResolvedValue({ error: { code: "23505", message: "dup" } });
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "tags") {
        return {
          select: () => ({ or: async () => ({ data: [] }) }),
          insert: tagsInsertMock,
        };
      }
      if (table === "item_tags") return { insert: itemTagsInsertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await addTagToItemAction("item-1", "Cozy");

    expect(result).toEqual({ tag: { id: "tag-new", name: "Cozy" } });
  });
});
