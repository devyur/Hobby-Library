import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/queries/lists.ts (issue #26), mirroring
// lib/queries/trash.test.ts's mocked-client shape: isolates the query
// shape (explicit user_id/ownership scoping, the items!inner join that
// makes `.is("items.deleted_at", null)` actually exclude a trashed
// member's row rather than just reshape the embed, added_at desc order,
// embedded-resource normalization) from the live database. The live
// cross-category/RLS/trash-visibility behavior is covered separately by
// e2e/lists.spec.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { getLists, getListDetail, getAddableItems } = await import("./lists");

function fakeSupabase(options: {
  user?: { id: string } | null;
  lists?: { data: unknown[] | null; error: { message: string } | null };
  listItems?: { data: unknown[] | null; error: { message: string } | null };
  list?: { data: unknown | null; error: { message: string } | null };
  memberItems?: { data: unknown[] | null; error: { message: string } | null };
  addableMembers?: { data: unknown[] | null; error: { message: string } | null };
  addableItems?: { data: unknown[] | null; error: { message: string } | null };
}) {
  // lists table: select().eq().order() (getLists) or
  // select().eq().eq().maybeSingle() (getListDetail).
  const listsOrderMock = vi
    .fn()
    .mockResolvedValue(options.lists ?? { data: [], error: null });
  const listsMaybeSingleMock = vi
    .fn()
    .mockResolvedValue(options.list ?? { data: null, error: null });
  const listsEqInner = vi.fn(() => ({ maybeSingle: listsMaybeSingleMock }));
  const listsEqMock = vi.fn(() => ({ order: listsOrderMock, eq: listsEqInner }));
  const listsSelectMock = vi.fn(() => ({ eq: listsEqMock }));

  // list_items table: select().in().is() (getLists' count query),
  // select().eq().is().order() (getListDetail's member-items query), or
  // select().eq() (getAddableItems' member-id query).
  const listItemsIsMock = vi
    .fn()
    .mockResolvedValue(options.listItems ?? { data: [], error: null });
  const listItemsInMock = vi.fn(() => ({ is: listItemsIsMock }));
  const memberOrderMock = vi
    .fn()
    .mockResolvedValue(options.memberItems ?? { data: [], error: null });
  const memberIsMock = vi.fn(() => ({ order: memberOrderMock }));
  const addableMembersEqMock = vi
    .fn()
    .mockResolvedValue(options.addableMembers ?? { data: [], error: null });
  const listItemsEqMock = vi.fn(() => ({
    is: memberIsMock,
    then: addableMembersEqMock.getMockImplementation(),
  }));
  const listItemsSelectMock = vi.fn(() => ({
    in: listItemsInMock,
    eq: listItemsEqMock,
  }));

  // items table (getAddableItems): select().eq().is().order() with an
  // optional trailing .not().
  const addableOrderResult = options.addableItems ?? { data: [], error: null };
  function addableTerminal() {
    return Promise.resolve(addableOrderResult);
  }
  const addableNotMock = vi.fn(() => addableTerminal());
  const addableOrderMock = vi.fn(() => ({
    ...addableTerminal(),
    not: addableNotMock,
  }));
  const addableIsMock = vi.fn(() => ({ order: addableOrderMock }));
  const addableEqMock = vi.fn(() => ({ is: addableIsMock }));
  const itemsSelectMock = vi.fn(() => ({ eq: addableEqMock }));

  const fromMock = vi.fn((table: string) => {
    if (table === "lists") return { select: listsSelectMock };
    if (table === "list_items") {
      return {
        select: (columns: string) => {
          if (columns === "item_id") {
            return { eq: addableMembersEqMock };
          }
          return listItemsSelectMock();
        },
      };
    }
    if (table === "items") return { select: itemsSelectMock };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    listsSelectMock,
    listsEqMock,
    listsEqInner,
    listsOrderMock,
    listItemsInMock,
    listItemsIsMock,
    memberIsMock,
    memberOrderMock,
    addableMembersEqMock,
    itemsSelectMock,
    addableEqMock,
    addableIsMock,
    addableOrderMock,
    addableNotMock,
  };
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("getLists", () => {
  it("returns an empty list without querying the database when unauthenticated", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLists();

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns an empty list without a second query when the caller owns no lists", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      lists: { data: [], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLists();

    expect(result).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("counts only non-trashed member items per list", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      lists: {
        data: [
          { id: "list-1", name: "Play next" },
          { id: "list-2", name: "Best games" },
        ],
        error: null,
      },
      listItems: {
        data: [{ list_id: "list-1" }, { list_id: "list-1" }, { list_id: "list-2" }],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getLists();

    expect(result).toEqual([
      { id: "list-1", name: "Play next", itemCount: 2 },
      { id: "list-2", name: "Best games", itemCount: 1 },
    ]);
    expect(supabase.listItemsInMock).toHaveBeenCalledWith("list_id", ["list-1", "list-2"]);
    expect(supabase.listItemsIsMock).toHaveBeenCalledWith("items.deleted_at", null);
  });
});

describe("getListDetail", () => {
  it("returns null without a second query when the list is not owned/does not exist", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { data: null, error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getListDetail("someone-elses-list");

    expect(result).toBeNull();
  });

  it("scopes the list lookup by id AND user_id, orders member items added_at desc, and normalizes embedded rows", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { data: { id: "list-1", name: "Play next" }, error: null },
      memberItems: {
        data: [
          {
            added_at: "2026-09-08T00:00:00.000Z",
            items: {
              id: "item-1",
              title: "Chrono Trigger",
              categories: { slug: "games", name: "Games" },
              subtypes: { name: "RPG" },
              item_images: [],
            },
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getListDetail("list-1");

    expect(result).toEqual({
      id: "list-1",
      name: "Play next",
      items: [
        {
          id: "item-1",
          title: "Chrono Trigger",
          categorySlug: "games",
          categoryName: "Games",
          subtypeName: "RPG",
          coverUrl: null,
        },
      ],
    });
    expect(supabase.memberIsMock).toHaveBeenCalledWith("items.deleted_at", null);
    expect(supabase.memberOrderMock).toHaveBeenCalledWith("added_at", { ascending: false });
  });
});

describe("getAddableItems", () => {
  it("returns an empty list without querying items when unauthenticated", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await getAddableItems("list-1");

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("excludes current list members via a NOT IN filter and scopes by user_id/deleted_at", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      addableMembers: { data: [{ item_id: "item-1" }], error: null },
      addableItems: {
        data: [
          {
            id: "item-2",
            title: "Another Game",
            categories: { slug: "games", name: "Games" },
            subtypes: { name: "RPG" },
          },
        ],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getAddableItems("list-1");

    expect(result).toEqual([
      {
        id: "item-2",
        title: "Another Game",
        categorySlug: "games",
        categoryName: "Games",
        subtypeName: "RPG",
      },
    ]);
    expect(supabase.addableEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(supabase.addableIsMock).toHaveBeenCalledWith("deleted_at", null);
    expect(supabase.addableNotMock).toHaveBeenCalledWith("id", "in", "(item-1)");
  });
});
