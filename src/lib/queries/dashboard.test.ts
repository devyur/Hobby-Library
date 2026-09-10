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

const { getDashboardData, getRecommendations } = await import("./dashboard");

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

// Unit coverage for getRecommendations (issue #28) -- mocks the Supabase
// client with one independent "thenable" fake query builder per
// `.from("items")` call, same chainable-mock pattern items.test.ts already
// uses for getLibraryItems' multi-step chain. getRecommendations() issues
// its four section queries concurrently via Promise.all, but since each
// section function only awaits *after* fully building its query chain
// synchronously, the `.from("items")` calls happen in a deterministic order
// every run: 1) high-rated Planned, 2) high-priority Planned, 3) random
// Planned's count-only query, 4) Continue/Ongoing, and -- only once the
// count resolves -- 5) random Planned's range-based row fetch. `results`
// below is consumed in that exact order.
interface FakeRecommendationsQuery
  extends PromiseLike<{
    data?: unknown[] | null;
    count?: number | null;
    error?: { message: string } | null;
  }> {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
}

function fakeRecommendationsSupabase(options: {
  user?: { id: string } | null;
  results?: Array<{ data?: unknown[] | null; count?: number | null; error?: { message: string } | null }>;
}) {
  const results = options.results ?? [];
  let callIndex = 0;
  const builders: FakeRecommendationsQuery[] = [];

  function makeBuilder(): FakeRecommendationsQuery {
    const result = results[callIndex] ?? { data: [], error: null };
    callIndex += 1;

    const builder: FakeRecommendationsQuery = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      range: vi.fn(() => builder),
      then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return builder;
  }

  const fromMock = vi.fn((table: string) => {
    if (table !== "items") throw new Error(`Unexpected table in test: ${table}`);
    const builder = makeBuilder();
    builders.push(builder);
    return builder;
  });

  const createSignedUrlMock = vi
    .fn()
    .mockResolvedValue({ data: { signedUrl: "https://signed.example/cover.jpg" } });
  const storageFromMock = vi.fn(() => ({ createSignedUrl: createSignedUrlMock }));

  return {
    from: fromMock,
    storage: { from: storageFromMock },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    builders,
    createSignedUrlMock,
    storageFromMock,
  };
}

function recommendationRow(overrides: {
  id?: string;
  title?: string;
  status?: string;
  rating?: number | null;
  priority?: string | null;
  categorySlug?: string;
  categoryName?: string;
  subtypeName?: string;
  tags?: string[];
  hasCover?: boolean;
}) {
  return {
    id: overrides.id ?? "item-1",
    title: overrides.title ?? "Some Item",
    status: overrides.status ?? "planned",
    rating: overrides.rating === undefined ? null : overrides.rating,
    priority: overrides.priority === undefined ? null : overrides.priority,
    categories: { slug: overrides.categorySlug ?? "books", name: overrides.categoryName ?? "Books" },
    subtypes: { name: overrides.subtypeName ?? "Fiction" },
    item_tags: (overrides.tags ?? []).map((name) => ({ tags: { name } })),
    item_images: overrides.hasCover
      ? [{ storage_path: `${overrides.id ?? "item-1"}/cover`, is_cover: true }]
      : [],
  };
}

// Four empty, error-free results in the deterministic call order documented
// above -- the baseline every test below overrides pieces of.
function emptyResults() {
  return [
    { data: [], error: null }, // high-rated Planned
    { data: [], error: null }, // high-priority Planned
    { count: 0, error: null }, // random Planned count
    { data: [], error: null }, // Continue/Ongoing
  ];
}

describe("getRecommendations", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns all-empty recommendations without querying items when unauthenticated", async () => {
    const supabase = fakeRecommendationsSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await getRecommendations();

    expect(result).toEqual({
      highRatedPlanned: [],
      highPriorityPlanned: [],
      randomPlanned: null,
      continueOngoing: [],
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("scopes every section's query to the signed-in user_id and excludes soft-deleted items", async () => {
    const supabase = fakeRecommendationsSupabase({ user: { id: "user-1" }, results: emptyResults() });
    createClientMock.mockResolvedValue(supabase);

    await getRecommendations();

    expect(supabase.builders).toHaveLength(4);
    for (const builder of supabase.builders) {
      expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
    }
  });

  it("high-rated Planned: filters status=planned and rating >= 8, ordered rating desc then created_at desc, capped at 5", async () => {
    const supabase = fakeRecommendationsSupabase({ user: { id: "user-1" }, results: emptyResults() });
    createClientMock.mockResolvedValue(supabase);

    await getRecommendations();

    const builder = supabase.builders[0];
    expect(builder.eq).toHaveBeenCalledWith("status", "planned");
    expect(builder.gte).toHaveBeenCalledWith("rating", 8);
    expect(builder.order).toHaveBeenNthCalledWith(1, "rating", { ascending: false });
    expect(builder.order).toHaveBeenNthCalledWith(2, "created_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(5);
  });

  it("high-priority Planned: filters status=planned and priority=high (no rating threshold), ordered created_at desc, capped at 5", async () => {
    const supabase = fakeRecommendationsSupabase({ user: { id: "user-1" }, results: emptyResults() });
    createClientMock.mockResolvedValue(supabase);

    await getRecommendations();

    const builder = supabase.builders[1];
    expect(builder.eq).toHaveBeenCalledWith("status", "planned");
    expect(builder.eq).toHaveBeenCalledWith("priority", "high");
    expect(builder.gte).not.toHaveBeenCalled();
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(5);
  });

  it("Continue: filters status=ongoing only (no rating/priority filter), ordered created_at desc, capped at 5", async () => {
    const supabase = fakeRecommendationsSupabase({ user: { id: "user-1" }, results: emptyResults() });
    createClientMock.mockResolvedValue(supabase);

    await getRecommendations();

    const builder = supabase.builders[3];
    expect(builder.eq).toHaveBeenCalledWith("status", "ongoing");
    expect(builder.gte).not.toHaveBeenCalled();
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(5);
  });

  it("random Planned: counts Planned items, then range-fetches exactly one row at a JS-computed random offset", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); // floor(0.5 * 10) = 5
    try {
      const supabase = fakeRecommendationsSupabase({
        user: { id: "user-1" },
        results: [
          { data: [], error: null },
          { data: [], error: null },
          { count: 10, error: null },
          { data: [], error: null },
          { data: [recommendationRow({ id: "random-item" })], error: null },
        ],
      });
      createClientMock.mockResolvedValue(supabase);

      const result = await getRecommendations();

      expect(supabase.builders).toHaveLength(5);
      const countBuilder = supabase.builders[2];
      expect(countBuilder.eq).toHaveBeenCalledWith("status", "planned");
      const rangeBuilder = supabase.builders[4];
      expect(rangeBuilder.range).toHaveBeenCalledWith(5, 5);
      expect(result.randomPlanned?.id).toBe("random-item");
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("random Planned: is null, with no range query issued, when the account has zero Planned items", async () => {
    const supabase = fakeRecommendationsSupabase({ user: { id: "user-1" }, results: emptyResults() });
    createClientMock.mockResolvedValue(supabase);

    const result = await getRecommendations();

    expect(result.randomPlanned).toBeNull();
    expect(supabase.builders).toHaveLength(4);
  });

  it("random Planned: is null (not a thrown error) when the count query itself errors", async () => {
    const supabase = fakeRecommendationsSupabase({
      user: { id: "user-1" },
      results: [
        { data: [], error: null },
        { data: [], error: null },
        { count: null, error: { message: "boom" } },
        { data: [], error: null },
      ],
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getRecommendations();

    expect(result.randomPlanned).toBeNull();
  });

  it("normalizes embedded category/subtype/tags and resolves a signed cover URL from the private covers bucket", async () => {
    const supabase = fakeRecommendationsSupabase({
      user: { id: "user-1" },
      results: [
        {
          data: [
            recommendationRow({
              id: "item-1",
              title: "Dune",
              status: "planned",
              rating: 9,
              priority: "high",
              categorySlug: "books",
              categoryName: "Books",
              subtypeName: "Sci-Fi",
              tags: ["space", "epic"],
              hasCover: true,
            }),
          ],
          error: null,
        },
        { data: [], error: null },
        { count: 0, error: null },
        { data: [], error: null },
      ],
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getRecommendations();

    expect(result.highRatedPlanned).toEqual([
      {
        id: "item-1",
        title: "Dune",
        status: "planned",
        rating: 9,
        priority: "high",
        categorySlug: "books",
        categoryName: "Books",
        subtypeName: "Sci-Fi",
        tags: ["space", "epic"],
        coverUrl: "https://signed.example/cover.jpg",
      },
    ]);
    expect(supabase.storageFromMock).toHaveBeenCalledWith("covers");
    expect(supabase.createSignedUrlMock).toHaveBeenCalledWith("item-1/cover", 60 * 60);
  });

  it("a section with no matching rows contributes an empty array, not undefined/null", async () => {
    const supabase = fakeRecommendationsSupabase({ user: { id: "user-1" }, results: emptyResults() });
    createClientMock.mockResolvedValue(supabase);

    const result = await getRecommendations();

    expect(result.highRatedPlanned).toEqual([]);
    expect(result.highPriorityPlanned).toEqual([]);
    expect(result.continueOngoing).toEqual([]);
  });

  it("returns an empty list for a section (not a thrown error) when its own query errors, independent of the other sections", async () => {
    const supabase = fakeRecommendationsSupabase({
      user: { id: "user-1" },
      results: [
        { data: null, error: { message: "boom" } }, // high-rated Planned errors
        { data: [recommendationRow({ id: "ok-priority" })], error: null },
        { count: 0, error: null },
        { data: [recommendationRow({ id: "ok-ongoing", status: "ongoing" })], error: null },
      ],
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await getRecommendations();

    expect(result.highRatedPlanned).toEqual([]);
    expect(result.highPriorityPlanned).toHaveLength(1);
    expect(result.continueOngoing).toHaveLength(1);
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
