import Link from "next/link";

import type { LibraryItem } from "@/lib/queries/items";

import { CoverThumbnail } from "./CoverThumbnail";
import { PriorityBadge } from "./PriorityBadge";
import { RatingBadge } from "./RatingBadge";
import { StatusPill } from "./StatusPill";
import { TagChips } from "./TagChips";

// Card view (issue #12): smaller cover thumbnails than the original
// mockup, more cards per row (see the grid in LibraryView.tsx), per
// ui-style-guide.md §3.
export function ItemCard({
  categorySlug,
  item,
}: {
  categorySlug: string;
  item: LibraryItem;
}) {
  return (
    <Link
      href={`/${categorySlug}/${item.id}`}
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
        {item.subtypeName}
      </span>
      <TagChips tags={item.tags} />
    </Link>
  );
}
