import Link from "next/link";

import type { LibraryItem } from "@/lib/queries/items";

import { PriorityBadge } from "./PriorityBadge";
import { RatingBadge } from "./RatingBadge";
import { StatusPill } from "./StatusPill";
import { TagChips } from "./TagChips";

// List view row (issue #12): ~44px tall, tight padding, per
// ui-style-guide.md §3's density rules for library views.
export function ItemListRow({
  categorySlug,
  item,
}: {
  categorySlug: string;
  item: LibraryItem;
}) {
  return (
    <Link
      href={`/${categorySlug}/${item.id}`}
      className="flex h-11 items-center gap-3 border-b border-border px-3 text-sm last:border-b-0 hover:bg-bg"
    >
      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
        {item.title}
      </span>
      <RatingBadge rating={item.rating} />
      <StatusPill status={item.status} />
      <span className="hidden shrink-0 text-text-secondary sm:inline">
        {item.subtypeName}
      </span>
      <TagChips tags={item.tags} />
      <PriorityBadge status={item.status} priority={item.priority} />
    </Link>
  );
}
