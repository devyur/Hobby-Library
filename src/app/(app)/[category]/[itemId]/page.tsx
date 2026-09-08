import { notFound } from "next/navigation";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { ItemAttachments } from "@/components/items/ItemAttachments";
import { ItemLinks } from "@/components/items/ItemLinks";
import { NotesReview } from "@/components/items/NotesReview";
import { PriorityBadge } from "@/components/items/PriorityBadge";
import { RatingBadge } from "@/components/items/RatingBadge";
import { StatusPill } from "@/components/items/StatusPill";
import { TagChips } from "@/components/items/TagChips";
import { formatDate } from "@/lib/format";
import { getItemDetail } from "@/lib/queries/items";
import { createClient } from "@/lib/supabase/server";

// Item detail page (issue #13): read-only. The category slug -> id lookup
// is the same one [category]/page.tsx (#12) already uses, unchanged --
// an unknown slug still 404s. Every other "not found" case (missing item,
// another user's item via RLS, category/slug mismatch, soft-deleted item,
// malformed-UUID itemId) collapses inside getItemDetail to a single `null`,
// which this page turns into the same plain notFound() -- no distinct
// error page/message, so an other-user's item and a nonexistent one stay
// indistinguishable and this page never leaks whether an item exists for
// someone else.
//
// ui-style-guide.md §3's density exception applies here: spacious/editorial
// layout, unlike the compact library list/card views.
export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ category: string; itemId: string }>;
}) {
  const { category: slug, itemId } = await params;

  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  if (!category) {
    notFound();
  }

  const item = await getItemDetail(category.id, itemId);

  if (!item) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="w-full shrink-0 sm:w-56">
          <CoverThumbnail coverUrl={item.coverUrl} title={item.title} />
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <h1 className="text-3xl font-semibold text-text-primary">{item.title}</h1>
          <p className="text-sm text-text-secondary">
            {category.name} · {item.subtypeName}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} />
            <RatingBadge rating={item.rating} />
            <PriorityBadge status={item.status} priority={item.priority} />
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-secondary">
            <div className="flex gap-1">
              <dt className="font-medium text-text-primary">Added:</dt>
              <dd>{formatDate(item.createdAt)}</dd>
            </div>
            {item.completedAt ? (
              <div className="flex gap-1">
                <dt className="font-medium text-text-primary">Completed:</dt>
                <dd>{formatDate(item.completedAt)}</dd>
              </div>
            ) : null}
          </dl>

          {item.tags.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium text-text-primary">Tags</h2>
              {/* Detail page never truncates -- maxVisible = the full tag
                  count, unlike the library view's default-3 "+N" behavior. */}
              <TagChips tags={item.tags} maxVisible={item.tags.length} />
            </div>
          ) : null}
        </div>
      </div>

      <NotesReview notes={item.notes} review={item.review} />

      <ItemLinks links={item.links} />

      <ItemAttachments attachments={item.attachments} />
    </div>
  );
}
