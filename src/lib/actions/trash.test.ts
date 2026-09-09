import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/trash.ts (issue #25's Restore/Permanent
// Delete), focused on what e2e coverage (e2e/trash.spec.ts) can exercise
// live but can't directly force or inspect: the ownership/in-Trash check
// short-circuiting before any write, the two-bucket Storage cleanup
// ordering (both buckets checked, remove() only called when a bucket
// actually has entries, the row DELETE only ever attempted after both
// buckets succeed), and that a Storage failure blocks the row delete
// entirely (nothing silently orphaned). Same createClient-mocking shape as
// lib/actions/attachments.test.ts/covers.test.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { restoreItemAction, permanentlyDeleteItemAction } = await import("./trash");

type FakeRow = Record<string, unknown> | null;

function itemsTable(item: FakeRow, options: { updateError?: { message: string } | null; deleteError?: { message: string } | null }) {
  const updateMock = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: options.updateError ?? null }),
  }));
  const deleteMock = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: options.deleteError ?? null }),
  }));
  return {
    table: {
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({ maybeSingle: async () => ({ data: item }) }),
          }),
        }),
      }),
      update: updateMock,
      delete: deleteMock,
    },
    updateMock,
    deleteMock,
  };
}

function fakeSupabase(options: {
  user?: { id: string } | null;
  item?: FakeRow;
  updateError?: { message: string } | null;
  deleteError?: { message: string } | null;
  bucketEntries?: Partial<Record<"covers" | "attachments", { name: string }[]>>;
  listError?: Partial<Record<"covers" | "attachments", { message: string } | null>>;
  removeError?: Partial<Record<"covers" | "attachments", { message: string } | null>>;
}) {
  const { table: itemsTableImpl, updateMock, deleteMock } = itemsTable(options.item ?? null, options);

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsTableImpl;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const listMocks: Record<string, ReturnType<typeof vi.fn>> = {};
  const removeMocks: Record<string, ReturnType<typeof vi.fn>> = {};

  const storageFromMock = vi.fn((bucket: "covers" | "attachments") => {
    const listMock = vi.fn(async () => ({
      data: options.bucketEntries?.[bucket] ?? [],
      error: options.listError?.[bucket] ?? null,
    }));
    const removeMock = vi.fn(async () => ({
      data: [],
      error: options.removeError?.[bucket] ?? null,
    }));
    listMocks[bucket] = listMock;
    removeMocks[bucket] = removeMock;
    return { list: listMock, remove: removeMock };
  });

  return {
    from: fromMock,
    storage: { from: storageFromMock },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    updateMock,
    deleteMock,
    listMocks,
    removeMocks,
  };
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("restoreItemAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await restoreItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item, a never-deleted item, or an already-restored one identically -- a plain 'no longer in Trash' error, update never called", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await restoreItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/no longer in trash/i) });
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("sets deleted_at back to null on success", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: { id: "item-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await restoreItemAction("item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.updateMock).toHaveBeenCalledWith({ deleted_at: null });
  });

  it("a failed update returns a clean error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await restoreItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to restore/i) });
  });
});

describe("permanentlyDeleteItemAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item / one not actually in Trash the same as a nonexistent one -- rejected before storage is ever touched", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/no longer in trash/i) });
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it("an item with nothing in either bucket still succeeds -- an empty list() result is not an error, remove() is never called, and the row is deleted", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      bucketEntries: { covers: [], attachments: [] },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.listMocks.covers).toHaveBeenCalledWith("user-1/item-1");
    expect(supabase.listMocks.attachments).toHaveBeenCalledWith("user-1/item-1");
    expect(supabase.removeMocks.covers).not.toHaveBeenCalled();
    expect(supabase.removeMocks.attachments).not.toHaveBeenCalled();
    expect(supabase.deleteMock).toHaveBeenCalledTimes(1);
  });

  it("removes every listed object in both buckets (full paths, one bulk remove call per bucket) before deleting the row", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      bucketEntries: {
        covers: [{ name: "cover" }],
        attachments: [{ name: "attach-1" }, { name: "attach-2" }],
      },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.removeMocks.covers).toHaveBeenCalledWith(["user-1/item-1/cover"]);
    expect(supabase.removeMocks.attachments).toHaveBeenCalledWith([
      "user-1/item-1/attach-1",
      "user-1/item-1/attach-2",
    ]);
    expect(supabase.deleteMock).toHaveBeenCalledTimes(1);
    // Storage cleanup strictly precedes the row delete.
    expect(supabase.removeMocks.attachments.mock.invocationCallOrder[0]).toBeLessThan(
      supabase.deleteMock.mock.invocationCallOrder[0],
    );
  });

  it("a storage list() failure in either bucket blocks the row delete entirely -- nothing removed, nothing deleted", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      bucketEntries: { covers: [{ name: "cover" }] },
      listError: { covers: { message: "storage exploded" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to check/i) });
    expect(supabase.removeMocks.covers).not.toHaveBeenCalled();
    expect(supabase.deleteMock).not.toHaveBeenCalled();
  });

  it("a storage remove() failure blocks the row delete entirely -- the item stays in Trash, retryable", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      bucketEntries: { covers: [{ name: "cover" }] },
      removeError: { covers: { message: "storage exploded" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to remove/i) });
    expect(supabase.deleteMock).not.toHaveBeenCalled();
  });

  it("a failure in the second bucket (attachments) still blocks the row delete, even though the first bucket (covers) already succeeded", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      bucketEntries: { covers: [{ name: "cover" }], attachments: [{ name: "attach-1" }] },
      removeError: { attachments: { message: "storage exploded" } },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to remove/i) });
    expect(supabase.removeMocks.covers).toHaveBeenCalledTimes(1);
    expect(supabase.deleteMock).not.toHaveBeenCalled();
  });

  it("a row DELETE failure (after successful storage cleanup) returns a clean error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      bucketEntries: { covers: [], attachments: [] },
      deleteError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await permanentlyDeleteItemAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to permanently delete/i) });
  });
});
