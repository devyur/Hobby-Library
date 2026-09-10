import type { CategoryTrend, MonthlyCompletionCount } from "@/lib/queries/dashboard";

// Completion trends by category (issue #27, folding in #43): one small
// monthly-completions chart per category, zero-filled from that category's
// earliest to latest completed_at month. Plain CSS bars, no charting
// library, matching RatingDistributionChart's style in LibraryStats.tsx. A
// separate component/file from LibraryStats per the issue's own
// Constraints (independently reviewable despite landing in the same
// issue).
//
// `completed_at` is unwritable anywhere in the shipped app today (#34 is
// still open) -- every category is expected to render its empty state on
// every real account until #34 ships. That's the correct, intended state
// here, not a bug.
export function CompletionTrends({ trends }: { trends: CategoryTrend[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">Completion trends</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {trends.map((trend) => (
          <CategoryTrendPanel key={trend.categoryId} trend={trend} />
        ))}
      </div>
    </section>
  );
}

function CategoryTrendPanel({ trend }: { trend: CategoryTrend }) {
  return (
    <div
      aria-label={`${trend.categoryName} completion trend`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <h3 className="text-sm font-medium text-text-primary">{trend.categoryName}</h3>
      {trend.months.length === 0 ? (
        <p className="text-xs text-text-secondary">No completion dates recorded yet.</p>
      ) : (
        <MonthlyBarChart months={trend.months} />
      )}
    </div>
  );
}

const TREND_BAR_MAX_HEIGHT_PX = 64;

function MonthlyBarChart({ months }: { months: MonthlyCompletionCount[] }) {
  const max = Math.max(1, ...months.map((month) => month.count));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-0.5" style={{ height: TREND_BAR_MAX_HEIGHT_PX }}>
        {months.map((month) => {
          const barHeight =
            month.count === 0 ? 0 : Math.max(3, Math.round((month.count / max) * TREND_BAR_MAX_HEIGHT_PX));

          return (
            <div
              key={month.month}
              title={`${formatMonthLabel(month.month)}: ${month.count}`}
              className="min-w-[3px] flex-1 rounded-t bg-accent"
              style={{ height: barHeight }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-secondary">
        <span>{formatMonthLabel(months[0].month)}</span>
        {months.length > 1 ? (
          <span>{formatMonthLabel(months[months.length - 1].month)}</span>
        ) : null}
      </div>
    </div>
  );
}

// A "YYYY-MM" -> "Jan 2025" label, scoped to this chart's X axis only --
// not a second general-purpose date helper alongside format.ts's
// formatDate (reused as-is for the Recently added list's dates), just a
// month/year label this component's own axis needs. Built from UTC
// year/month numbers (Date.UTC) to match the UTC month bucketing
// getDashboardData() uses when deriving `month` from completed_at.
function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
    new Date(Date.UTC(year, monthNum - 1, 1)),
  );
}
