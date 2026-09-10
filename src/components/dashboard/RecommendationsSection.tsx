import Link from "next/link";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { PriorityBadge } from "@/components/items/PriorityBadge";
import { RatingBadge } from "@/components/items/RatingBadge";
import { StatusPill } from "@/components/items/StatusPill";
import { TagChips } from "@/components/items/TagChips";
import { getRecommendations, type RecommendationItem } from "@/lib/queries/dashboard";

// Dashboard's Recommendations block (issue #28), composed into
// dashboard/page.tsx at the insertion point #27 left. Self-contained --
// fetches its own data (getRecommendations(), lib/queries/dashboard.ts)
// rather than taking props from #27's stats component, per this issue's own
// Constraints.
//
// Four independent sub-sections, each hidden entirely when its own query
// returns zero rows (no empty box); if all four are empty the whole block
// collapses to one shared message instead of a stray "Recommendations"
// heading over nothing.
//
// Cards reuse RatingBadge/StatusPill/PriorityBadge/CoverThumbnail/TagChips
// (not ItemCard, which assumes a single-category LibraryItem with no
// categorySlug) so each card can link cross-category to the right
// `/{categorySlug}/{itemId}`.
export async function RecommendationsSection() {
  const { highRatedPlanned, highPriorityPlanned, randomPlanned, continueOngoing } =
    await getRecommendations();

  const allEmpty =
    highRatedPlanned.length === 0 &&
    highPriorityPlanned.length === 0 &&
    randomPlanned === null &&
    continueOngoing.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">Recommendations</h2>
      {allEmpty ? (
        <p className="text-sm text-text-secondary">
          No recommendations yet — add a few items to your library to see suggestions here.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {highRatedPlanned.length > 0 ? (
            <RecommendationGroup title="High-rated Planned" items={highRatedPlanned} />
          ) : null}
          {highPriorityPlanned.length > 0 ? (
            <RecommendationGroup title="High-priority Planned" items={highPriorityPlanned} />
          ) : null}
          {randomPlanned ? (
            <RecommendationGroup title="Random pick" items={[randomPlanned]} />
          ) : null}
          {continueOngoing.length > 0 ? (
            <RecommendationGroup title="Continue" items={continueOngoing} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function RecommendationGroup({ title, items }: { title: string; items: RecommendationItem[] }) {
  return (
    <div aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <RecommendationCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function RecommendationCard({ item }: { item: RecommendationItem }) {
  return (
    <Link
      href={`/${item.categorySlug}/${item.id}`}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 text-sm hover:border-accent"
    >
      <CoverThumbnail coverUrl={item.coverUrl} title={item.title} />
      <span className="truncate font-medium text-text-primary">{item.title}</span>
      <div className="flex flex-wrap items-center gap-1">
        <RatingBadge rating={item.rating} />
        <StatusPill status={item.status} />
        <PriorityBadge status={item.status} priority={item.priority} />
      </div>
      <span className="truncate text-xs text-text-secondary">
        {item.categoryName} · {item.subtypeName}
      </span>
      <TagChips tags={item.tags} />
    </Link>
  );
}
