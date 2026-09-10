import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for getDashboardData (issue #27, folding in #43) -- mocks
// the Supabase client the same way lib/queries/trash.test.ts does, plus
// mocks getCategories (lib/queries/categories.ts) directly rather than
// driving it through the same fake client, since it's a separately-tested
// dependency this module just composes with. Isolates every derived-stat
// computation (status counts, average rating, recently added, completion
// rate, rating distribution, category breakdown, completion trends'
// zero-filled months) from the live database -- the live cross-category/RLS
// behavior + real rendering is covered separately by e2e/dashboard.spec.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const getCategoriesMock = vi.fn();
vi.mock("@/lib/queries/categories", () => ({
  getCategories: (...args: unknown[]) => getCategoriesMock(...args),
}));

const { getDashboardData } = await import("./dashboard");

function fakeSupabase(itemsResult: { data: unknown[] | null; error: { message: string } | null }) {
  const isMock = vi.fn().mockResolvedValue(itemsResult);
  const selectMock = vi.fn(() => ({ is: isMock }));
  const fromMock = vi.fn((table: string) => {
    if (table === "items") return { select: selectMock };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from: fromMock, selectMock, isMock };
}

const CATEGORIES = [
  { id: "cat-games", slug: "games", name: "Games" },
  { id: "cat-books", slug: "books", name: "Books" },
];

describe("getDashboardData", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    getCategoriesMock.mockReset();
    getCategoriesMock.mockResolvedValue(CATEGORIES);
  });

  it("returns all-zero/empty-state stats and one empty trend panel per category for a brand-new account", async () => {
    const supabase = fakeSupabase({ data: [], error: null });
    createClientMock.mockResolvedValue(supabase);

    const { stats, trends } = await getDashboardData();

    expect(stats).toEqual({
      totalItems: 0,
      statusCounts: { planned: 0, ongoing: 0, completed: 0, dropped: 0 },
      averageRating: null,
      recentItems: [],
      completionRatePercent: null,
      ratingDistribution: new Array(10).fill(0),
      categoryBreakdown: [],
    });
    expect(trends).toEqual([
      { categoryId: "cat-games", categoryName: "Games", months: [] },
      { categoryId: "cat-books", categoryName: "Books", months: [] },
    ]);
  });

  it("scopes the items read to non-deleted rows only (.is deleted_at null), no explicit user_id filter (RLS-scoped)", async () => {
    const supabase = fakeSupabase({ data: [], error: null });
    createClientMock.mockResolvedValue(supabase);

    await getDashboardData();

    expect(supabase.selectMock).toHaveBeenCalledWith(
      "id, title, status, rating, category_id, created_at, completed_at",
    );
    expect(supabase.isMock).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns the empty-state stats/trends (not a thrown error) when the items query errors", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    createClientMock.mockResolvedValue(supabase);

    const { stats, trends } = await getDashboardData();

    expect(stats.totalItems).toBe(0);
    expect(trends).toHaveLength(2);
    expect(trends[0].months).toEqual([]);
  });

  it("computes total items and zero-filled per-status counts across all four statuses", async () => {
    const supabase = fakeSupabase({
      data: [
        row({ status: "planned" }),
        row({ status: "planned" }),
        row({ status: "ongoing" }),
        row({ status: "completed" }),
      ],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.totalItems).toBe(4);
    expect(stats.statusCounts).toEqual({ planned: 2, ongoing: 1, completed: 1, dropped: 0 });
  });

  it("averages non-null ratings across all statuses, rounded to 1 decimal, excluding unrated items", async () => {
    const supabase = fakeSupabase({
      data: [row({ rating: 8 }), row({ rating: 9 }), row({ rating: null }), row({ rating: 7 })],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    // (8 + 9 + 7) / 3 = 8 exactly
    expect(stats.averageRating).toBe(8);
  });

  it("rounds a non-terminating average to 1 decimal place", async () => {
    const supabase = fakeSupabase({
      data: [row({ rating: 7 }), row({ rating: 8 }), row({ rating: 8 })],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    // (7 + 8 + 8) / 3 = 7.666... -> rounds to 7.7
    expect(stats.averageRating).toBe(7.7);
  });

  it("returns null average rating when zero items have a rating", async () => {
    const supabase = fakeSupabase({
      data: [row({ rating: null }), row({ rating: null })],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.averageRating).toBeNull();
  });

  it("returns the 5 most recently added items, newest first, with category name/slug resolved via the categories list", async () => {
    const supabase = fakeSupabase({
      data: [
        row({ id: "1", title: "Oldest", createdAt: "2026-01-01T00:00:00Z" }),
        row({ id: "2", title: "Newest", createdAt: "2026-06-01T00:00:00Z" }),
        row({ id: "3", title: "Middle", createdAt: "2026-03-01T00:00:00Z" }),
        row({ id: "4", title: "Fourth", createdAt: "2026-02-01T00:00:00Z", categoryId: "cat-books" }),
        row({ id: "5", title: "Fifth", createdAt: "2026-04-01T00:00:00Z" }),
        row({ id: "6", title: "Sixth (dropped)", createdAt: "2026-05-01T00:00:00Z" }),
      ],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.recentItems).toHaveLength(5);
    expect(stats.recentItems.map((item) => item.title)).toEqual([
      "Newest",
      "Sixth (dropped)",
      "Fifth",
      "Middle",
      "Fourth",
    ]);
    expect(stats.recentItems[0]).toEqual({
      id: "2",
      title: "Newest",
      categorySlug: "games",
      categoryName: "Games",
      createdAt: "2026-06-01T00:00:00Z",
    });
    expect(stats.recentItems[4]).toMatchObject({ categorySlug: "books", categoryName: "Books" });
  });

  it("returns all items (fewer than 5) when the account has fewer than 5 items", async () => {
    const supabase = fakeSupabase({ data: [row({ id: "1" }), row({ id: "2" })], error: null });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.recentItems).toHaveLength(2);
  });

  it("computes completion rate as completed / (completed + dropped), excluding planned/ongoing", async () => {
    const supabase = fakeSupabase({
      data: [
        row({ status: "completed" }),
        row({ status: "completed" }),
        row({ status: "completed" }),
        row({ status: "dropped" }),
        row({ status: "planned" }),
        row({ status: "ongoing" }),
      ],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    // 3 completed / (3 completed + 1 dropped) = 75%
    expect(stats.completionRatePercent).toBe(75);
  });

  it("returns null completion rate when completed + dropped is 0 (only planned/ongoing items)", async () => {
    const supabase = fakeSupabase({
      data: [row({ status: "planned" }), row({ status: "ongoing" })],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.completionRatePercent).toBeNull();
  });

  it("renders all 10 rating buckets, zero-filled, excluding null ratings entirely", async () => {
    const supabase = fakeSupabase({
      data: [
        row({ rating: 10 }),
        row({ rating: 10 }),
        row({ rating: 1 }),
        row({ rating: null }),
      ],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.ratingDistribution).toHaveLength(10);
    expect(stats.ratingDistribution[0]).toBe(1); // rating 1
    expect(stats.ratingDistribution[9]).toBe(2); // rating 10
    expect(stats.ratingDistribution.reduce((sum, count) => sum + count, 0)).toBe(3); // null excluded
  });

  it("breaks down items by category, omitting zero-count categories, sorted by count desc", async () => {
    const supabase = fakeSupabase({
      data: [
        row({ categoryId: "cat-games" }),
        row({ categoryId: "cat-games" }),
        row({ categoryId: "cat-books" }),
      ],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { stats } = await getDashboardData();

    expect(stats.categoryBreakdown).toEqual([
      { categoryId: "cat-games", categoryName: "Games", count: 2 },
      { categoryId: "cat-books", categoryName: "Books", count: 1 },
    ]);
  });

  it("zero-fills completion-trend months from the earliest to latest completed_at, per category, using only completed_at (not created_at)", async () => {
    const supabase = fakeSupabase({
      data: [
        row({ categoryId: "cat-games", completedAt: "2025-01-15T00:00:00Z" }),
        row({ categoryId: "cat-games", completedAt: "2025-01-20T00:00:00Z" }),
        row({ categoryId: "cat-games", completedAt: "2025-08-01T00:00:00Z" }),
        // No completed_at -- must not count anywhere.
        row({ categoryId: "cat-games", completedAt: null }),
        // Different category -- must not leak into Games' trend.
        row({ categoryId: "cat-books", completedAt: "2025-03-01T00:00:00Z" }),
      ],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { trends } = await getDashboardData();

    const games = trends.find((t) => t.categoryId === "cat-games");
    expect(games?.months).toEqual([
      { month: "2025-01", count: 2 },
      { month: "2025-02", count: 0 },
      { month: "2025-03", count: 0 },
      { month: "2025-04", count: 0 },
      { month: "2025-05", count: 0 },
      { month: "2025-06", count: 0 },
      { month: "2025-07", count: 0 },
      { month: "2025-08", count: 1 },
    ]);

    const books = trends.find((t) => t.categoryId === "cat-books");
    expect(books?.months).toEqual([{ month: "2025-03", count: 1 }]);
  });

  it("shows the empty-state (empty months array) for a category with items but none having completed_at set", async () => {
    const supabase = fakeSupabase({
      data: [row({ categoryId: "cat-games", completedAt: null })],
      error: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const { trends } = await getDashboardData();

    const games = trends.find((t) => t.categoryId === "cat-games");
    expect(games?.months).toEqual([]);
  });
});

let rowCounter = 0;

function row(overrides: {
  id?: string;
  title?: string;
  status?: string;
  rating?: number | null;
  categoryId?: string;
  createdAt?: string;
  completedAt?: string | null;
}) {
  rowCounter += 1;
  return {
    id: overrides.id ?? `item-${rowCounter}`,
    title: overrides.title ?? `Item ${rowCounter}`,
    status: overrides.status ?? "planned",
    rating: overrides.rating === undefined ? null : overrides.rating,
    category_id: overrides.categoryId ?? "cat-games",
    created_at: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    completed_at: overrides.completedAt === undefined ? null : overrides.completedAt,
  };
}
