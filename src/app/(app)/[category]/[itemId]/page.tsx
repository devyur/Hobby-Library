import { notFound } from "next/navigation";

import { CoverUploadControl } from "@/components/items/CoverUploadControl";
import { ItemAttachments } from "@/components/items/ItemAttachments";
import { ItemLinksEditor } from "@/components/items/ItemLinksEditor";
import { getItemDetail } from "@/lib/queries/items";
import { getSubtypes } from "@/lib/queries/subtypes";
import { getTags } from "@/lib/queries/tags";
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
// Title and category/subtype label stay here, permanently read-only.
// Cover also renders here via CoverUploadControl (issue #19 -- upload/
// replace only, wrapping the read-only CoverThumbnail from #12) -- still
// not inside ItemEditForm.tsx, whose own header comment explains why it
// stays out of that form's Edit/Save toggle. status/rating/priority/notes/
// review, plus the Added/Completed dates and Tags that visually sit
// alongside them, are owned by ItemEditForm, a client component that needs
// its own React state for the view/edit toggle.
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

  // Autocomplete data source for the Tags section's "add a tag" input
  // (issue #17) -- every tag visible to the signed-in user (predefined +
  // their own custom tags), same scope the Full Add form's checkbox list
  // already uses.
  const tagSuggestions = await getTags();

  // Subtype picker options for ItemEditForm's edit-mode Subtype control
  // (issue #18) -- every subtype visible to the signed-in user (predefined +
  // their own custom rows), pre-filtered here to this item's own
  // (unchanged) category rather than passing the full cross-category list
  // and filtering client-side like AddItemForm.tsx does -- there's only ever
  // one category to filter to on this page, since category itself isn't
  // editable.
  const allSubtypes = await getSubtypes();
  const subtypeOptions = allSubtypes
    .filter((subtype) => subtype.categoryId === item.categoryId)
    .map((subtype) => ({ id: subtype.id, name: subtype.name }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="w-full shrink-0 sm:w-56">
          <CoverUploadControl itemId={item.id} coverUrl={item.coverUrl} title={item.title} />
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
        categoryId={item.categoryId}
        subtypeId={item.subtypeId}
        subtypeOptions={subtypeOptions}
        tags={item.tags}
        tagSuggestions={tagSuggestions}
      />

      {/* Always interactive, independent of ItemEditForm's Edit/Save toggle
          (issue #20) -- same #17/ItemTagsEditor precedent. Owns its own
          local links state (see the component's header comment for why
          that's safe here, unlike ItemTagsEditor). */}
      <ItemLinksEditor itemId={item.id} initialLinks={item.links} />

      <ItemAttachments attachments={item.attachments} />
    </div>
  );
}
