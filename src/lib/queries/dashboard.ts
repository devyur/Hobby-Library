import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getCategories } from "@/lib/queries/categories";

// Dashboard stats (issue #27, folding in #43's completion-trend charts).
// Library-wide (all categories combined), following items.ts's existing
// conventions: no explicit user_id filter (RLS on `items` already scopes
// reads to auth.uid()), explicit `.is("deleted_at", null)` per the #25
// pattern, Server Component context only.
//
// Per the issue's own Constraints: ONE query against `items` (minimal
// columns), every stat derived from that single result set in application
// code below -- no per-metric aggregate round trip. A second, separate call
// to the existing getCategories() (categories.ts) is also made: the
// Completion trends panel needs one chart per category *including*
// categories the user has zero items in at all (so its empty state renders
// for those too), which no amount of restructuring the items query could
// reveal on its own -- there would be no rows for a category with zero
// items to begin with. That same categories list (id -> name/slug) is also
// reused to resolve names for Recently added / Category breakdown below,
// which avoids embedding a duplicate `categories ( name, slug )` relation
// into the items select just to get data this second, already-necessary
// query already carries -- one query against `items`, one small query
// against the global `categories` table, no other round trips.

type ItemStatus = Database["public"]["Enums"]["item_status"];
type PriorityLevel = Database["public"]["Enums"]["priority_level"];

export interface RecentItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  createdAt: string;
}

export interface CategoryBreakdownEntry {
  categoryId: string;
  categoryName: string;
  count: number;
}

export interface DashboardStats {
  totalItems: number;
  // Always all four keys present (zero-filled), per the "four counts" AC.
  statusCounts: Record<ItemStatus, number>;
  // Mean of non-null ratings, rounded to 1 decimal; null when zero rated items.
  averageRating: number | null;
  recentItems: RecentItem[];
  // completed / (completed + dropped) as a rounded whole-number percentage;
  // null when the denominator is 0.
  completionRatePercent: number | null;
  // Always length 10 (index 0 = rating 1 ... index 9 = rating 10), zero-filled.
  ratingDistribution: number[];
  // Only categories with >=1 item, sorted by count desc.
  categoryBreakdown: CategoryBreakdownEntry[];
}

export interface MonthlyCompletionCount {
  // "YYYY-MM", UTC calendar month (completed_at is a timestamptz; bucketing
  // by the UTC month keeps this deterministic regardless of viewer/server
  // timezone, rather than depending on either one's local clock).
  month: string;
  count: number;
}

export interface CategoryTrend {
  categoryId: string;
  categoryName: string;
  // Empty array => "No completion dates recorded yet" (this category has no
  // non-deleted item with completed_at set). Otherwise zero-filled from the
  // earliest to the latest completed_at month, inclusive.
  months: MonthlyCompletionCount[];
}

export interface DashboardData {
  stats: DashboardStats;
  trends: CategoryTrend[];
}

function emptyStatusCounts(): Record<ItemStatus, number> {
  return { planned: 0, ongoing: 0, completed: 0, dropped: 0 };
}

function emptyStats(): DashboardStats {
  return {
    totalItems: 0,
    statusCounts: emptyStatusCounts(),
    averageRating: null,
    recentItems: [],
    completionRatePercent: null,
    ratingDistribution: new Array(10).fill(0),
    categoryBreakdown: [],
  };
}

// Fills every month from startMonth to endMonth inclusive (both "YYYY-MM"),
// zero-counting any month absent from `counts` -- the "continuous run of
// monthly bars... rather than only the months with data" acceptance
// criterion. Plain integer year/month arithmetic (no Date object) sidesteps
// any timezone ambiguity entirely.
function fillMonthRange(
  startMonth: string,
  endMonth: string,
  counts: Map<string, number>,
): MonthlyCompletionCount[] {
  const [startYear, startMonthNum] = startMonth.split("-").map(Number);
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);

  const months: MonthlyCompletionCount[] = [];
  let year = startYear;
  let month = startMonthNum;

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push({ month: key, count: counts.get(key) ?? 0 });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();

  const [itemsResult, categories] = await Promise.all([
    supabase
      .from("items")
      .select("id, title, status, rating, category_id, created_at, completed_at")
      .is("deleted_at", null),
    getCategories(),
  ]);

  // Every category gets a trend panel (empty state if it has none) even
  // before any items-row processing below -- built here so it's the
  // fallback on a query error too.
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const emptyTrends: CategoryTrend[] = categories.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    months: [],
  }));

  if (itemsResult.error) {
    // Swallowed rather than thrown, same convention as every other query in
    // this codebase: a Dashboard that renders its zero-state because of a
    // transient read error is better than one that crashes outright.
    console.error("Failed to load dashboard data:", itemsResult.error.message);
    return { stats: emptyStats(), trends: emptyTrends };
  }

  const rows = itemsResult.data ?? [];

  // -- Total items + per-status counts --
  const statusCounts = emptyStatusCounts();
  for (const row of rows) {
    statusCounts[row.status] += 1;
  }

  // -- Average rating (all statuses, rating is independent of status) --
  const ratedValues = rows
    .map((row) => row.rating)
    .filter((rating): rating is number => rating !== null);
  const averageRating =
    ratedValues.length === 0
      ? null
      : Math.round((ratedValues.reduce((sum, r) => sum + r, 0) / ratedValues.length) * 10) / 10;

  // -- Recently added: 5 most recent by created_at desc --
  const recentItems: RecentItem[] = [...rows]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)
    .map((row) => {
      const category = categoriesById.get(row.category_id);
      return {
        id: row.id,
        title: row.title,
        categorySlug: category?.slug ?? "",
        categoryName: category?.name ?? "",
        createdAt: row.created_at,
      };
    });

  // -- Completion rate: completed / (completed + dropped), "—" (null) when denom is 0 --
  const completionDenominator = statusCounts.completed + statusCounts.dropped;
  const completionRatePercent =
    completionDenominator === 0
      ? null
      : Math.round((statusCounts.completed / completionDenominator) * 100);

  // -- Rating distribution: all 10 buckets, zero-filled, NULL ratings excluded --
  const ratingDistribution = new Array(10).fill(0) as number[];
  for (const rating of ratedValues) {
    ratingDistribution[rating - 1] += 1;
  }

  // -- Category breakdown: count per category, omit zero, sort desc --
  const breakdownCounts = new Map<string, number>();
  for (const row of rows) {
    breakdownCounts.set(row.category_id, (breakdownCounts.get(row.category_id) ?? 0) + 1);
  }
  const categoryBreakdown: CategoryBreakdownEntry[] = Array.from(breakdownCounts.entries())
    .map(([categoryId, count]) => ({
      categoryId,
      categoryName: categoriesById.get(categoryId)?.name ?? "",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // -- Completion trends: monthly completion counts per category --
  const monthCountsByCategory = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.completed_at) continue;
    const month = row.completed_at.slice(0, 7); // "YYYY-MM" (UTC, see MonthlyCompletionCount)
    let monthCounts = monthCountsByCategory.get(row.category_id);
    if (!monthCounts) {
      monthCounts = new Map();
      monthCountsByCategory.set(row.category_id, monthCounts);
    }
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }

  const trends: CategoryTrend[] = categories.map((category) => {
    const monthCounts = monthCountsByCategory.get(category.id);
    if (!monthCounts || monthCounts.size === 0) {
      return { categoryId: category.id, categoryName: category.name, months: [] };
    }
    const monthKeys = Array.from(monthCounts.keys()).sort();
    const months = fillMonthRange(monthKeys[0], monthKeys[monthKeys.length - 1], monthCounts);
    return { categoryId: category.id, categoryName: category.name, months };
  });

  return {
    stats: {
      totalItems: rows.length,
      statusCounts,
      averageRating,
      recentItems,
      completionRatePercent,
      ratingDistribution,
      categoryBreakdown,
    },
    trends,
  };
}

// ---------------------------------------------------------------------------
// Recommendations (issue #28) -- a second, independent read added alongside
// getDashboardData() above rather than folded into it: that function's one
// `items` query fetches only the columns needed for aggregate stats (no
// cover/tags/category join), while every recommendation needs the full
// card shape (categorySlug/categoryName, subtypeName, tags, coverUrl) plus
// per-section status/rating/priority filtering and its own ORDER BY/LIMIT --
// none of which the stats query's single unfiltered read can serve without
// widening it for everyone. What IS shared here is the query-building/
// row-normalizing logic itself (fetchRecommendationRows below), used by all
// four sections, so the "avoid duplicating the base items fetch" instruction
// is honored at the code level even though each section still issues its
// own round trip to Postgres (the issue's own "four independent queries, no
// combined/weighted scoring" requirement rules out collapsing them into one
// request).
//
// Every query explicitly filters `.eq("user_id", user.id)` and
// `.is("deleted_at", null)` rather than relying on RLS alone, matching
// trash.ts/lists.ts's convention.
//
// Random Planned pick: the issue's acceptance criteria call for
// `ORDER BY random() LIMIT 1` evaluated in Postgres. PostgREST's `order`
// query param only accepts column/computed-field identifiers, not arbitrary
// SQL expressions -- `.order("random()")` was verified live against this
// project's Supabase instance and rejected with a parse error (PGRST100).
// The only way to get literal `ORDER BY random()` is a stored Postgres
// function, which requires a new migration -- something this issue's own
// Constraints explicitly rule out ("No new tables/columns/migrations").
// Resolved by picking a uniformly random OFFSET in JS from a `count`-only
// query, then fetching exactly that one row via `.range(offset, offset)`
// (see getRandomPlanned below) -- still a single-row, Postgres-side fetch
// each render (never fetches the full Planned list into JS to shuffle/index
// into), and still re-rolled fresh on every call since nothing is cached.
// Flagged on the issue as a deviation from the literal SQL technique named
// in the acceptance criteria, per software-engineer.md's guidance for a
// contradiction between an AC and a Constraint.

const HIGH_RATED_THRESHOLD = 8;
const RECOMMENDATION_CAP = 5;

// Signed URLs are resolved per request rather than cached -- same reasoning
// as getLibraryItems' own copy of this constant (private/path-scoped
// `covers` bucket, never getPublicUrl()).
const RECOMMENDATION_COVER_SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface RecommendationItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  status: ItemStatus;
  rating: number | null;
  priority: PriorityLevel | null;
  subtypeName: string;
  tags: string[];
  coverUrl: string | null;
}

export interface RecommendationsData {
  highRatedPlanned: RecommendationItem[];
  highPriorityPlanned: RecommendationItem[];
  // null when the account has zero Planned items -- no row to pick.
  randomPlanned: RecommendationItem | null;
  continueOngoing: RecommendationItem[];
}

// Shared select/order/limit-or-range builder + row normalization for every
// recommendation section -- see the header comment above for why this is
// factored out (avoids duplicating the cover-signing/tag-flattening logic
// four times) while still issuing one query per call site.
async function fetchRecommendationRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  filter: {
    status: ItemStatus;
    minRating?: number;
    priority?: PriorityLevel;
    orderBy: Array<{ column: string; ascending: boolean }>;
    limit?: number;
    range?: [number, number];
  },
): Promise<RecommendationItem[]> {
  let query = supabase
    .from("items")
    .select(
      `
      id,
      title,
      status,
      rating,
      priority,
      categories ( slug, name ),
      subtypes ( name ),
      item_tags ( tags ( name ) ),
      item_images ( storage_path, is_cover )
    `,
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", filter.status);

  if (filter.minRating !== undefined) {
    query = query.gte("rating", filter.minRating);
  }
  if (filter.priority !== undefined) {
    query = query.eq("priority", filter.priority);
  }
  for (const { column, ascending } of filter.orderBy) {
    query = query.order(column, { ascending });
  }
  if (filter.limit !== undefined) {
    query = query.limit(filter.limit);
  }
  if (filter.range !== undefined) {
    query = query.range(filter.range[0], filter.range[1]);
  }

  const { data, error } = await query;

  if (error) {
    console.error(
      `Failed to load ${filter.status} recommendations:`,
      error.message,
    );
    return [];
  }

  return Promise.all(
    (data ?? []).map(async (row) => {
      // Same defensive embedded-resource normalization as getLibraryItems/
      // getTrashedItems -- this project's types.ts is generated by a
      // fallback tool (see its header comment), not the literal
      // `supabase gen types` CLI.
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      const subtype = Array.isArray(row.subtypes) ? row.subtypes[0] : row.subtypes;
      const images = Array.isArray(row.item_images) ? row.item_images : [];
      const coverImage = images.find((image) => image.is_cover);

      let coverUrl: string | null = null;
      if (coverImage) {
        const { data: signed } = await supabase.storage
          .from("covers")
          .createSignedUrl(coverImage.storage_path, RECOMMENDATION_COVER_SIGNED_URL_TTL_SECONDS);
        coverUrl = signed?.signedUrl ?? null;
      }

      const tagRows = Array.isArray(row.item_tags) ? row.item_tags : [];
      const tags = tagRows
        .map((itemTag) => {
          const tag = Array.isArray(itemTag.tags) ? itemTag.tags[0] : itemTag.tags;
          return tag?.name ?? null;
        })
        .filter((name): name is string => name !== null);

      return {
        id: row.id,
        title: row.title,
        status: row.status,
        rating: row.rating,
        priority: row.priority,
        categorySlug: category?.slug ?? "",
        categoryName: category?.name ?? "",
        subtypeName: subtype?.name ?? "",
        tags,
        coverUrl,
      };
    }),
  );
}

// Section 1: high-rated Planned -- rating >= 8 (NULL ratings never match a
// `.gte` threshold, same as getLibraryItems' minRating filter), rating desc
// then created_at desc, capped at 5.
async function getHighRatedPlanned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<RecommendationItem[]> {
  return fetchRecommendationRows(supabase, userId, {
    status: "planned",
    minRating: HIGH_RATED_THRESHOLD,
    orderBy: [
      { column: "rating", ascending: false },
      { column: "created_at", ascending: false },
    ],
    limit: RECOMMENDATION_CAP,
  });
}

// Section 2: high-priority Planned -- priority = 'high', created_at desc,
// capped at 5.
async function getHighPriorityPlanned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<RecommendationItem[]> {
  return fetchRecommendationRows(supabase, userId, {
    status: "planned",
    priority: "high",
    orderBy: [{ column: "created_at", ascending: false }],
    limit: RECOMMENDATION_CAP,
  });
}

// Section 3: one random Planned item -- see the header comment above for why
// this is a count + random OFFSET rather than literal `ORDER BY random()`.
// Re-rolled fresh on every call (no session pinning, no caching): a new
// `Math.random()` offset and a new pair of queries every render.
async function getRandomPlanned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<RecommendationItem | null> {
  const { count, error: countError } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "planned");

  if (countError) {
    console.error("Failed to count Planned items for random pick:", countError.message);
    return null;
  }
  if (!count || count === 0) {
    return null;
  }

  const offset = Math.floor(Math.random() * count);

  const rows = await fetchRecommendationRows(supabase, userId, {
    status: "planned",
    // Any stable column works as the ORDER BY here -- it only exists to
    // make `.range(offset, offset)` deterministic across the two queries;
    // the "randomness" itself is the JS-computed offset above, freshly
    // rolled every call.
    orderBy: [{ column: "id", ascending: true }],
    range: [offset, offset],
  });

  return rows[0] ?? null;
}

// Section 4: Continue (unfinished Ongoing) -- Ongoing is unfinished by
// definition, no extra filter needed. created_at desc, capped at 5.
async function getContinueOngoing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<RecommendationItem[]> {
  return fetchRecommendationRows(supabase, userId, {
    status: "ongoing",
    orderBy: [{ column: "created_at", ascending: false }],
    limit: RECOMMENDATION_CAP,
  });
}

// Dashboard's Recommendations block (RecommendationsSection.tsx). All four
// sections run concurrently, each its own independent query -- no
// de-duplication across them (a Planned item can legitimately appear in
// more than one section, or be the random pick too), per the issue's own
// "deliberate simplicity choice" acceptance criterion.
export async function getRecommendations(): Promise<RecommendationsData> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defensive only -- middleware.ts already redirects an unauthenticated
    // request to /login before this route is ever reachable.
    return { highRatedPlanned: [], highPriorityPlanned: [], randomPlanned: null, continueOngoing: [] };
  }

  const [highRatedPlanned, highPriorityPlanned, randomPlanned, continueOngoing] = await Promise.all([
    getHighRatedPlanned(supabase, user.id),
    getHighPriorityPlanned(supabase, user.id),
    getRandomPlanned(supabase, user.id),
    getContinueOngoing(supabase, user.id),
  ]);

  return { highRatedPlanned, highPriorityPlanned, randomPlanned, continueOngoing };
}
