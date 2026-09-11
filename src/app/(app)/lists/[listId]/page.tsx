import { notFound } from "next/navigation";

import { ListDetailEditor } from "@/components/lists/ListDetailEditor";
import { getAddableItems, getListDetail } from "@/lib/queries/lists";

// List detail page (issue #26) -- new route, opened from lists/page.tsx.
// getListDetail already scopes to the caller's own list (ownership +
// existence collapse to the same `null`, same reasoning
// [category]/[itemId]/page.tsx's own header comment documents for
// getItemDetail) -- a listId for another user's list, or one that no longer
// exists, 404s the same indistinguishable way here.
//
// getAddableItems is fetched alongside (not inside ListDetailEditor) since
// it needs the same server-only Supabase client as getListDetail -- it's
// every one of the caller's own non-deleted items across all categories,
// already excluding this list's current members (issue #26's Constraints:
// search_item_ids() is category-scoped and can't back this cross-category
// picker).
//
// getAddableItems takes only `listId` (a route param, already known) --
// it doesn't read anything getListDetail returns, so the two run
// concurrently via Promise.all (issue #58's sequential-query audit) rather
// than waiting on getListDetail first. The rare not-found/other-user's-list
// case now also fires getAddableItems before notFound() short-circuits
// (one harmless wasted read, itself empty since that case has no valid
// list membership to exclude), cheaper than serializing the common case.
export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ listId: string }>;
}) {
  const { listId } = await params;

  const [list, addableItems] = await Promise.all([
    getListDetail(listId),
    getAddableItems(listId),
  ]);
  if (!list) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <h1 className="text-lg font-semibold text-text-primary">{list.name}</h1>

      <ListDetailEditor
        listId={list.id}
        initialItems={list.items}
        initialAddableItems={addableItems}
      />
    </div>
  );
}
