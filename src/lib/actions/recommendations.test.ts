import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/recommendations.ts (issue #44's Dismiss/
// Undo/Shuffle Server Actions), same createClient-mocking shape as
// lib/actions/trash.test.ts: focused on the ownership check short-circuiting
// before any write, that the right column/value is persisted, and that
// rerollRandomPlannedAction just delegates to the query layer (already unit
// tested in dashboard.test.ts).

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const getRandomPlannedRecommendationMock = vi.fn();
vi.mock("@/lib/queries/dashboard", () => ({
  getRandomPlannedRecommendation: (...args: unknown[]) => getRandomPlannedRecommendationMock(...args),
}));

const {
  dismissRecommendationAction,
  undismissRecommendationAction,
  rerollRandomPlannedAction,
} = await import("./recommendations");

type FakeRow = Record<string, unknown> | null;

function itemsTable(item: FakeRow, updateError: { message: string } | null) {
  const updateMock = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: updateError }),
  }));
  return {
    table: {
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: item }) }),
          }),
        }),
      }),
      update: updateMock,
    },
    updateMock,
  };
}

function fakeSupabase(options: {
  user?: { id: string } | null;
  item?: FakeRow;
  updateError?: { message: string } | null;
}) {
  const { table: itemsTableImpl, updateMock } = itemsTable(
    options.item ?? null,
    options.updateError ?? null,
  );

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsTableImpl;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    updateMock,
  };
}

beforeEach(() => {
  createClientMock.mockReset();
  getRandomPlannedRecommendationMock.mockReset();
});

describe("dismissRecommendationAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await dismissRecommendationAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item (or a nonexistent one) as not found -- update never called", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await dismissRecommendationAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("sets recommendation_dismissed_at to a fresh ISO timestamp on success, keyed by this item's own id", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: { id: "item-1" } });
    createClientMock.mockResolvedValue(supabase);

    const fixedNow = "2026-09-11T12:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedNow));
    try {
      const result = await dismissRecommendationAction("item-1");
      expect(result).toEqual({ success: true });
      expect(supabase.updateMock).toHaveBeenCalledWith({
        recommendation_dismissed_at: fixedNow,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed update returns a clean error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await dismissRecommendationAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to dismiss/i) });
  });
});

describe("undismissRecommendationAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await undismissRecommendationAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item as not found -- update never called", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await undismissRecommendationAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("sets recommendation_dismissed_at back to null on success", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: { id: "item-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await undismissRecommendationAction("item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.updateMock).toHaveBeenCalledWith({ recommendation_dismissed_at: null });
  });

  it("a failed update returns a clean error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await undismissRecommendationAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to undo/i) });
  });
});

describe("rerollRandomPlannedAction", () => {
  it("delegates directly to getRandomPlannedRecommendation and returns its result unchanged", async () => {
    const item = { id: "random-1", title: "Dune" };
    getRandomPlannedRecommendationMock.mockResolvedValue(item);

    const result = await rerollRandomPlannedAction();

    expect(result).toBe(item);
    expect(getRandomPlannedRecommendationMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no eligible Planned item left to pick", async () => {
    getRandomPlannedRecommendationMock.mockResolvedValue(null);

    const result = await rerollRandomPlannedAction();

    expect(result).toBeNull();
  });
});
