import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/links.ts (issue #20), same
// createClient-mocking shape as lib/actions/tags.test.ts -- focused on the
// branches e2e coverage (e2e/item-links.spec.ts) can exercise live but can't
// directly force/inspect: the server-side URL re-validation, the
// ownership/ not-found check, and the insert/delete payloads.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { addLinkAction, removeLinkAction } = await import("./links");

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

function fakeSupabase(options: { user?: { id: string } | null; item?: FakeRow }) {
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

describe("addLinkAction", () => {
  it("rejects an empty/whitespace-only URL before ever calling createClient", async () => {
    const result = await addLinkAction("item-1", "   ", "");

    expect(result).toEqual({ error: expect.any(String) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a schemeless URL before ever calling createClient", async () => {
    const result = await addLinkAction("item-1", "imdb.com", "IMDb");

    expect(result).toEqual({ error: expect.any(String) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a javascript: scheme URL before ever calling createClient", async () => {
    const result = await addLinkAction("item-1", "javascript:alert(1)", "");

    expect(result).toEqual({ error: expect.any(String) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await addLinkAction("item-1", "https://example.com", "");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one -- a plain error, never a distinguishable RLS/Postgres error", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await addLinkAction("someone-elses-item", "https://example.com", "");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
  });

  it("inserts a link scoped to the item, storing a blank label as null", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: "link-1", url: "https://example.com", label: null },
      error: null,
    });
    const selectMock = vi.fn(() => ({ single: singleMock }));
    const insertMock = vi.fn(() => ({ select: selectMock }));
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "item_links") return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await addLinkAction("item-1", "https://example.com", "");

    expect(result).toEqual({ link: { id: "link-1", url: "https://example.com", label: null } });
    expect(insertMock).toHaveBeenCalledWith({
      item_id: "item-1",
      url: "https://example.com",
      label: null,
    });
  });

  it("inserts a link with a trimmed label when provided", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: "link-2", url: "https://imdb.com/title/1", label: "IMDb" },
      error: null,
    });
    const selectMock = vi.fn(() => ({ single: singleMock }));
    const insertMock = vi.fn(() => ({ select: selectMock }));
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "item_links") return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await addLinkAction("item-1", "https://imdb.com/title/1", "  IMDb  ");

    expect(result).toEqual({
      link: { id: "link-2", url: "https://imdb.com/title/1", label: "IMDb" },
    });
    expect(insertMock).toHaveBeenCalledWith({
      item_id: "item-1",
      url: "https://imdb.com/title/1",
      label: "IMDb",
    });
  });
});

describe("removeLinkAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeLinkAction("item-1", "link-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeLinkAction("someone-elses-item", "link-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
  });

  it("deletes only the item_links row for this (item, link) pair", async () => {
    const secondEq = vi.fn().mockResolvedValue({ error: null });
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const deleteMock = vi.fn(() => ({ eq: firstEq }));
    const fromMock = vi.fn((table: string) => {
      if (table === "items") return itemsTable({ id: "item-1" });
      if (table === "item_links") return { delete: deleteMock };
      throw new Error(`Unexpected table: ${table}`);
    });
    createClientMock.mockResolvedValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    const result = await removeLinkAction("item-1", "link-1");

    expect(result).toEqual({ success: true });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(firstEq).toHaveBeenCalledWith("item_id", "item-1");
    expect(secondEq).toHaveBeenCalledWith("id", "link-1");
  });
});
