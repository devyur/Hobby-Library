import { notFound } from "next/navigation";

import { CoverUploadControl } from "@/components/items/CoverUploadControl";
import { ItemAttachmentsEditor } from "@/components/items/ItemAttachmentsEditor";
import { ItemLinksEditor } from "@/components/items/ItemLinksEditor";
import { ItemListsEditor } from "@/components/items/ItemListsEditor";
import { getItemDetail } from "@/lib/queries/items";
import { getListsForItem } from "@/lib/queries/lists";
import { getSubtypes } from "@/lib/queries/subtypes";
import { getTags } from "@/lib/queries/tags";
import { createClient } from "@/lib/supabase/server";

import {
  ItemEditFormNotesReview,
  ItemEditFormPrimary,
  ItemEditFormProvider,
} from "./ItemEditForm";

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

  // Membership data for the Lists shortcut section (issue #41) -- every
  // list the signed-in user owns, flagged with whether this item is
  // already a member. `lists` has no category column (database-schema.md
  // §3), so this is never filtered to item.categoryId the way
  // subtypeOptions above is.
  const itemLists = await getListsForItem(item.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      {/* Title/subtype heading spans the full width above both columns --
          not inside the cover/content split below. */}
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-text-primary">{item.title}</h1>
        <p className="text-sm text-text-secondary">
          {category.name} · {item.subtypeName}
        </p>
      </div>

      {/* Two-column on wider viewports: cover, status/rating/actions, Added
          date, Tags, Links, Attachments, and Lists stack in a left column;
          Notes and Review sit alone in a right column (follow-up UI
          adjustment after 6ef579d's initial two-column pass, per the human
          user's visual QA on that layout -- the earlier arrangement put
          status/rating/actions/dates/tags at the top of the right column,
          ahead of Notes/Review, leaving the left column just the cover).
          Collapses to a single stacked column below md -- cover and
          primary status/actions near the top, Links/Attachments/Lists/
          Notes/Review after -- matching NavShell.tsx's shell breakpoint,
          since the mobile/responsive pass (#31) hasn't touched this page
          yet.
          ItemEditFormProvider wraps the whole grid and renders no DOM of
          its own (see ItemEditForm.tsx's header comment) -- it just shares
          isEditing/tags/etc. state between the two consumers placed below,
          in the left and right columns respectively. */}
      <ItemEditFormProvider
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
      >
        <div className="flex flex-col gap-8 md:grid md:grid-cols-[14rem_1fr] md:items-start">
          <div className="flex flex-col gap-8">
            <div className="w-full shrink-0">
              <CoverUploadControl itemId={item.id} coverUrl={item.coverUrl} title={item.title} />
            </div>

            {/* Status/rating/priority badges, Edit/Delete, Added/Completed
                dates, and Tags -- view mode by default, toggled into an
                edit form in place (issue #16). Detail page never truncates
                tags -- maxVisible = the full tag count, unlike the library
                view's default-3 "+N" behavior. */}
            <ItemEditFormPrimary />

            {/* Always interactive, independent of ItemEditForm's Edit/Save
                toggle (issue #20) -- same #17/ItemTagsEditor precedent. Owns
                its own local links state (see the component's header comment
                for why that's safe here, unlike ItemTagsEditor). */}
            <ItemLinksEditor itemId={item.id} initialLinks={item.links} />

            {/* Always interactive, independent of ItemEditForm's Edit/Save
                toggle (issue #21) -- same ItemLinksEditor precedent. Owns its
                own local attachments state, seeded from the server-rendered
                item.attachments, for the same "never unmounted by page.tsx"
                reason ItemLinksEditor documents. */}
            <ItemAttachmentsEditor itemId={item.id} initialAttachments={item.attachments} />

            {/* Always interactive, independent of ItemEditForm's Edit/Save
                toggle (issue #41) -- same ItemLinksEditor/
                ItemAttachmentsEditor precedent. Owns its own local lists
                state, seeded from the server-rendered itemLists, for the
                same "never unmounted by page.tsx" reason those components'
                header comments document. */}
            <ItemListsEditor itemId={item.id} initialLists={itemLists} />
          </div>

          <div className="flex flex-col gap-8">
            <ItemEditFormNotesReview />
          </div>
        </div>
      </ItemEditFormProvider>
    </div>
  );
}
