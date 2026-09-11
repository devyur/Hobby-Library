import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/lists.ts (issue #26, extended by #42's
// sort_order/reorder support), focused on what e2e coverage
// (e2e/lists.spec.ts) can exercise live but can't directly force/inspect:
// the ownership checks short-circuiting before any write (another user's
// list/item id resolves the same as a nonexistent one, never a
// distinguishable error), the client+server name/payload validation, and
// duplicate-add-is-a-no-op handling on list_items' (list_id, item_id)
// primary key. Same createClient-mocking shape as lib/actions/tags.test.ts/
// trash.test.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const {
  createListAction,
  renameListAction,
  deleteListAction,
  addItemToListAction,
  removeItemFromListAction,
  reorderListItemsAction,
} = await import("./lists");

type FakeRow = Record<string, unknown> | null;

// Matches getOwnedList's own select().eq("id",...).eq("user_id",...).maybeSingle()
// shape in lib/actions/lists.ts.
function listsSelectTable(list: FakeRow) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: list }) }),
      }),
    }),
  };
}

// Matches getOwnedItem's own select().eq("id",...).eq("user_id",...).is("deleted_at", null)
// .maybeSingle() shape -- same shape as lib/actions/tags.ts's own itemsTable helper.
function itemsSelectTable(item: FakeRow) {
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
  list?: FakeRow;
  item?: FakeRow;
  listsInsert?: { data: FakeRow; error: { message: string } | null };
  listsUpdateError?: { message: string } | null;
  listsDeleteError?: { message: string } | null;
  listItemsInsertError?: { message: string; code?: string } | null;
  listItemsDeleteError?: { message: string } | null;
  // addItemToListAction's "highest current sort_order" lookup (issue #42).
  highestSortOrder?: { sort_order: number } | null;
  // reorderListItemsAction's current-membership check (issue #42).
  currentMembers?: { data: { item_id: string }[] | null; error: { message: string } | null };
  listItemsUpsertError?: { message: string } | null;
}) {
  const listsUpdateEq = vi.fn().mockResolvedValue({ error: options.listsUpdateError ?? null });
  const listsUpdateMock = vi.fn(() => ({ eq: listsUpdateEq }));

  const listsDeleteEq = vi.fn().mockResolvedValue({ error: options.listsDeleteError ?? null });
  const listsDeleteMock = vi.fn(() => ({ eq: listsDeleteEq }));

  const listsInsertSingle = vi
    .fn()
    .mockResolvedValue(options.listsInsert ?? { data: null, error: null });
  const listsInsertMock = vi.fn(() => ({ select: () => ({ single: listsInsertSingle }) }));

  const listItemsInsertMock = vi
    .fn()
    .mockResolvedValue({ error: options.listItemsInsertError ?? null });

  const listItemsDeleteEqItem = vi
    .fn()
    .mockResolvedValue({ error: options.listItemsDeleteError ?? null });
  const listItemsDeleteEqList = vi.fn(() => ({ eq: listItemsDeleteEqItem }));
  const listItemsDeleteMock = vi.fn(() => ({ eq: listItemsDeleteEqList }));

  // addItemToListAction: select("sort_order").eq("list_id",...)
  // .order("sort_order",{ascending:false}).limit(1).maybeSingle()
  const highestMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: options.highestSortOrder ?? null });
  const highestLimitMock = vi.fn(() => ({ maybeSingle: highestMaybeSingle }));
  const highestOrderMock = vi.fn(() => ({ limit: highestLimitMock }));
  const highestEqMock = vi.fn(() => ({ order: highestOrderMock }));

  // reorderListItemsAction: select("item_id").eq("list_id",...) -- resolves
  // directly, no further chaining.
  const currentMembersEqMock = vi
    .fn()
    .mockResolvedValue(options.currentMembers ?? { data: [], error: null });

  const listItemsUpsertMock = vi
    .fn()
    .mockResolvedValue({ error: options.listItemsUpsertError ?? null });

  const listItemsSelectMock = vi.fn((columns: string) => {
    if (columns === "sort_order") return { eq: highestEqMock };
    if (columns === "item_id") return { eq: currentMembersEqMock };
    throw new Error(`Unexpected list_items select columns in test: ${columns}`);
  });

  const listsTableImpl = {
    ...listsSelectTable(options.list ?? null),
    insert: listsInsertMock,
    update: listsUpdateMock,
    delete: listsDeleteMock,
  };

  const itemsTableImpl = itemsSelectTable(options.item ?? null);

  const listItemsTableImpl = {
    select: listItemsSelectMock,
    insert: listItemsInsertMock,
    delete: listItemsDeleteMock,
    upsert: listItemsUpsertMock,
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "lists") return listsTableImpl;
    if (table === "items") return itemsTableImpl;
    if (table === "list_items") return listItemsTableImpl;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    listsInsertMock,
    listsUpdateMock,
    listsUpdateEq,
    listsDeleteMock,
    listsDeleteEq,
    listItemsInsertMock,
    listItemsDeleteMock,
    listItemsDeleteEqList,
    listItemsDeleteEqItem,
    highestEqMock,
    highestOrderMock,
    highestLimitMock,
    currentMembersEqMock,
    listItemsUpsertMock,
  };
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("createListAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await createListAction("Play next");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects a blank/whitespace-only name client-side, without ever calling the database", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await createListAction("   ");

    expect(result).toEqual({ error: expect.stringMatching(/enter a list name/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("inserts a list row owned by the caller and returns it", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      listsInsert: { data: { id: "list-1", name: "Play next" }, error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await createListAction("Play next");

    expect(result).toEqual({ list: { id: "list-1", name: "Play next" } });
    expect(supabase.listsInsertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      name: "Play next",
    });
  });
});

describe("renameListAction", () => {
  it("rejects a blank name client-side, without touching the database", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await renameListAction("list-1", "");

    expect(result).toEqual({ error: expect.stringMatching(/enter a list name/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's list id the same as a nonexistent one -- a plain error, never a distinguishable RLS/Postgres error", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await renameListAction("someone-elses-list", "New name");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.listsUpdateMock).not.toHaveBeenCalled();
  });

  it("updates the list's name once ownership is confirmed", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: { id: "list-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await renameListAction("list-1", "  New name  ");

    expect(result).toEqual({ success: true });
    expect(supabase.listsUpdateMock).toHaveBeenCalledWith({ name: "New name" });
    expect(supabase.listsUpdateEq).toHaveBeenCalledWith("id", "list-1");
  });
});

describe("deleteListAction", () => {
  it("treats another user's list id the same as a nonexistent one, without ever calling delete", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteListAction("someone-elses-list");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.listsDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes only the lists row for an owned list -- list_items cascade is left to the DB FK, never deleted explicitly here", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: { id: "list-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteListAction("list-1");

    expect(result).toEqual({ success: true });
    expect(supabase.listsDeleteMock).toHaveBeenCalled();
    expect(supabase.listsDeleteEq).toHaveBeenCalledWith("id", "list-1");
    expect(supabase.from).not.toHaveBeenCalledWith("list_items");
  });
});

describe("addItemToListAction", () => {
  it("treats another user's list id the same as a nonexistent one, without ever checking the item", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: null, item: { id: "item-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await addItemToListAction("someone-elses-list", "item-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.listItemsInsertMock).not.toHaveBeenCalled();
  });

  it("treats another user's (or trashed) item id the same as a nonexistent one, without ever inserting", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: { id: "list-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await addItemToListAction("list-1", "someone-elses-item");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.listItemsInsertMock).not.toHaveBeenCalled();
  });

  it("inserts a list_items row at sort_order 0 when the list is currently empty", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      item: { id: "item-1" },
      highestSortOrder: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await addItemToListAction("list-1", "item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.listItemsInsertMock).toHaveBeenCalledWith({
      list_id: "list-1",
      item_id: "item-1",
      sort_order: 0,
    });
  });

  it("appends the new item after the list's current highest sort_order (issue #42)", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      item: { id: "item-1" },
      highestSortOrder: { sort_order: 4 },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await addItemToListAction("list-1", "item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.highestEqMock).toHaveBeenCalledWith("list_id", "list-1");
    expect(supabase.highestOrderMock).toHaveBeenCalledWith("sort_order", { ascending: false });
    expect(supabase.highestLimitMock).toHaveBeenCalledWith(1);
    expect(supabase.listItemsInsertMock).toHaveBeenCalledWith({
      list_id: "list-1",
      item_id: "item-1",
      sort_order: 5,
    });
  });

  it("treats a duplicate-add primary-key violation (23505) as a no-op success, not an error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      item: { id: "item-1" },
      listItemsInsertError: { message: "duplicate key value", code: "23505" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await addItemToListAction("list-1", "item-1");

    expect(result).toEqual({ success: true });
  });

  it("surfaces a non-duplicate insert error as a plain error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      item: { id: "item-1" },
      listItemsInsertError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await addItemToListAction("list-1", "item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to add item/i) });
  });
});

describe("removeItemFromListAction", () => {
  it("treats another user's list id the same as a nonexistent one, without ever deleting", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeItemFromListAction("someone-elses-list", "item-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.listItemsDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes only the (list_id, item_id) list_items row -- the items row itself is never touched", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: { id: "list-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeItemFromListAction("list-1", "item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.listItemsDeleteEqList).toHaveBeenCalledWith("list_id", "list-1");
    expect(supabase.listItemsDeleteEqItem).toHaveBeenCalledWith("item_id", "item-1");
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });
});

describe("reorderListItemsAction (issue #42)", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("list-1", ["item-1", "item-2"]);

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects an empty item-id array client-side, without ever calling the database", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("list-1", []);

    expect("error" in result).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects a payload with duplicate item ids client-side, without ever calling the database", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("list-1", ["item-1", "item-1"]);

    expect("error" in result).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's list id the same as a nonexistent one, without ever reading/writing list_items", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, list: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("someone-elses-list", ["item-1", "item-2"]);

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.currentMembersEqMock).not.toHaveBeenCalled();
    expect(supabase.listItemsUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects a payload whose item-id set doesn't match the list's actual current members, without writing anything", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      currentMembers: { data: [{ item_id: "item-1" }, { item_id: "item-2" }], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    // Names an id ("item-3") that isn't actually a member of this list --
    // e.g. a crafted payload trying to fold in some other item_id.
    const result = await reorderListItemsAction("list-1", ["item-1", "item-3"]);

    expect("error" in result).toBe(true);
    expect(supabase.listItemsUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects a payload with too few ids for the list's actual membership, without writing anything", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      currentMembers: { data: [{ item_id: "item-1" }, { item_id: "item-2" }], error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("list-1", ["item-1"]);

    expect("error" in result).toBe(true);
    expect(supabase.listItemsUpsertMock).not.toHaveBeenCalled();
  });

  it("upserts sort_order for every row in the new order as a single call", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      currentMembers: {
        data: [{ item_id: "item-1" }, { item_id: "item-2" }, { item_id: "item-3" }],
        error: null,
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("list-1", ["item-3", "item-1", "item-2"]);

    expect(result).toEqual({ success: true });
    expect(supabase.listItemsUpsertMock).toHaveBeenCalledTimes(1);
    expect(supabase.listItemsUpsertMock).toHaveBeenCalledWith(
      [
        { list_id: "list-1", item_id: "item-3", sort_order: 0 },
        { list_id: "list-1", item_id: "item-1", sort_order: 1 },
        { list_id: "list-1", item_id: "item-2", sort_order: 2 },
      ],
      { onConflict: "list_id,item_id" },
    );
  });

  it("surfaces an upsert error as a plain error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      list: { id: "list-1" },
      currentMembers: { data: [{ item_id: "item-1" }, { item_id: "item-2" }], error: null },
      listItemsUpsertError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await reorderListItemsAction("list-1", ["item-2", "item-1"]);

    expect(result).toEqual({ error: expect.stringMatching(/failed to save the new order/i) });
  });
});
