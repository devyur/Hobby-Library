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
