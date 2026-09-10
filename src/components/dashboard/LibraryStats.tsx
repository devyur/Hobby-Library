import Link from "next/link";

import { STATUS_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { CategoryBreakdownEntry, DashboardStats } from "@/lib/queries/dashboard";

// The Dashboard's seven library-wide stats (issue #27), styled per
// ui-direction.md's "Your library" totals row + "Library statistics" block.
// Plain CSS bars throughout -- no charting library, per the issue's own
// Constraints. The eighth stat (Completion trends) is its own component,
// CompletionTrends.tsx, composed alongside this one rather than inside it.
export function LibraryStats({ stats }: { stats: DashboardStats }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-primary">Your library</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Total" value={String(stats.totalItems)} />
          {STATUS_KEYS.map((status) => (
            <StatTile
              key={status}
              label={STATUS_LABELS[status]}
              value={String(stats.statusCounts[status])}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-primary">Library statistics</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTile
            label="Average rating"
            value={stats.averageRating === null ? "No ratings yet" : stats.averageRating.toFixed(1)}
          />
          <StatTile
            label="Completion rate"
            value={stats.completionRatePercent === null ? "—" : `${stats.completionRatePercent}%`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">Rating distribution</h3>
            <RatingDistributionChart distribution={stats.ratingDistribution} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">Category breakdown</h3>
            <CategoryBreakdownList breakdown={stats.categoryBreakdown} />
          </div>
        </div>

        <div
          aria-label="Recently added"
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
        >
          <h3 className="text-sm font-medium text-text-primary">Recently added</h3>
          <RecentItemsList items={stats.recentItems} />
        </div>
      </section>
    </div>
  );
}

// Fixed order per the "four counts" acceptance criteria (matching the
// item_status enum's own declared order, supabase/migrations/
// 20260908130000_create_items_table.sql).
const STATUS_KEYS = ["planned", "ongoing", "completed", "dropped"] as const;

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      aria-label={`${label}: ${value}`}
      className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface p-4 text-center"
    >
      <span className="text-2xl font-semibold text-text-primary">{value}</span>
      <span className="text-xs text-text-secondary">{label}</span>
    </div>
  );
}

const RATING_BAR_MAX_HEIGHT_PX = 96;

// Histogram over the 10 possible integer ratings -- all 10 buckets always
// render (including zero-count ones), so the chart's shape is consistent
// between users regardless of how many/which ratings they've actually set.
function RatingDistributionChart({ distribution }: { distribution: number[] }) {
  const max = Math.max(1, ...distribution);

  return (
    <div className="flex items-end gap-1.5">
      {distribution.map((count, index) => {
        const rating = index + 1;
        const barHeight = count === 0 ? 0 : Math.max(4, Math.round((count / max) * RATING_BAR_MAX_HEIGHT_PX));

        return (
          <div
            key={rating}
            aria-label={`Rating ${rating}: ${count}`}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <span className="text-[10px] text-text-secondary">{count}</span>
            <div
              className="flex w-full items-end"
              style={{ height: RATING_BAR_MAX_HEIGHT_PX }}
            >
              <div className="w-full rounded-t bg-accent" style={{ height: barHeight }} />
            </div>
            <span className="text-[10px] text-text-secondary">{rating}</span>
          </div>
        );
      })}
    </div>
  );
}

function CategoryBreakdownList({ breakdown }: { breakdown: CategoryBreakdownEntry[] }) {
  if (breakdown.length === 0) {
    return <p className="text-sm text-text-secondary">No items yet.</p>;
  }

  const max = Math.max(...breakdown.map((entry) => entry.count));

  return (
    <ul className="flex flex-col gap-2">
      {breakdown.map((entry) => (
        <li
          key={entry.categoryId}
          aria-label={`${entry.categoryName}: ${entry.count} items`}
          className="flex items-center gap-3"
        >
          <span className="w-24 shrink-0 truncate text-sm text-text-primary">
            {entry.categoryName}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(entry.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-sm text-text-secondary">
            {entry.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RecentItemsList({ items }: { items: DashboardStats["recentItems"] }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">No items yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/${item.categorySlug}/${item.id}`}
            className="min-w-0 truncate text-sm font-medium text-text-primary hover:text-accent"
          >
            {item.title}
          </Link>
          <span className="shrink-0 text-xs text-text-secondary">
            {item.categoryName} · Added {formatDate(item.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
