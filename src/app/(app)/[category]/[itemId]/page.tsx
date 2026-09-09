import { notFound } from "next/navigation";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { ItemAttachments } from "@/components/items/ItemAttachments";
import { ItemLinks } from "@/components/items/ItemLinks";
import { getItemDetail } from "@/lib/queries/items";
import { createClient } from "@/lib/supabase/server";

import { ItemEditForm } from "./ItemEditForm";

// Item detail page (issue #13, view mode; issue #16 adds the inline
// edit-mode toggle for status/rating/priority/notes/review via
// ItemEditForm.tsx below -- same route/URL, no dedicated /edit page). The
// category slug -> id lookup is the same one [category]/page.tsx (#12)
// already uses, unchanged -- an unknown slug still 404s. Every other "not
// found" case (missing item, another user's item via RLS, category/slug
// mismatch, soft-deleted item, malformed-UUID itemId) collapses inside
// getItemDetail to a single `null`, which this page turns into the same
// plain notFound() -- no distinct error page/message, so an other-user's
// item and a nonexistent one stay indistinguishable and this page never
// leaks whether an item exists for someone else.
//
// ui-style-guide.md §3's density exception applies here: spacious/editorial
// layout, unlike the compact library list/card views.
//
// Title, category/subtype label, and cover stay here (never editable, per
// #16's Out of scope) -- status/rating/priority/notes/review, plus the
// Added/Completed dates and Tags that visually sit alongside them, are
// owned by ItemEditForm, a client component that needs its own React state
// for the view/edit toggle.
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
        </div>
      </div>

      {/* Status/rating/priority/notes/review, plus the Added/Completed
          dates and Tags that sit alongside them -- view mode by default,
          toggled into an edit form in place (issue #16). Detail page never
          truncates tags -- maxVisible = the full tag count, unlike the
          library view's default-3 "+N" behavior. */}
      <ItemEditForm
        itemId={item.id}
        status={item.status}
        rating={item.rating}
        priority={item.priority}
        notes={item.notes}
        review={item.review}
        createdAt={item.createdAt}
        completedAt={item.completedAt}
        tags={item.tags}
      />

      <ItemLinks links={item.links} />

      <ItemAttachments attachments={item.attachments} />
    </div>
  );
}
